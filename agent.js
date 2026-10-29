// Agent control for the bridge (and the Monodesk MCP server): lets Claude see and drive any tab in Monodesk, like a
// small Playwright that works inside the apps you're already signed in to. List the tabs, read a page's text, list its
// buttons and fields by number, click, type, press keys, take a screenshot, go to a link, or run a script in the page.
// Playwright itself can't do this: it doesn't see Electron <webview> tabs, which is what every Monodesk app is.
const { webContents } = require('electron');

const APP_HOSTS = [[/^mail\.google\.com$/, 'mail'], [/^calendar\.google\.com$/, 'calendar'], [/(^|\.)notion\.(so|site|com)$/, 'notion'], [/(^|\.)claude\.ai$/, 'claude'], [/^web\.whatsapp\.com$/, 'whatsapp']];

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function appOf(url) {
  try {
    const host = new URL(url).hostname;
    return (APP_HOSTS.find(([re]) => re.test(host)) || [])[1] || host;
  } catch { return ''; }
}

// Every app tab in the Monodesk window (not Dispatch's hidden Claude windows, and not blank tabs that haven't loaded).
function views() {
  return webContents.getAllWebContents().filter((c) => !c.isDestroyed() && c.getType() === 'webview' && /^https:/.test(c.getURL()));
}

function view(id) {
  const c = views().find((x) => x.id === Number(id));
  if (!c) throw fail(`There's no Monodesk tab ${id}. List the tabs again: tabs get new numbers when they reload or Monodesk restarts.`, 404);
  return c;
}

const run = (c, fn, ...args) => c.executeJavaScript(`(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`, true);

/* ---------- scripts that run inside the page ---------- */

function pageText(selector, max) {
  const el = selector ? document.querySelector(selector) : document.body;
  if (!el) return { error: `Nothing on the page matches ${selector}.` };
  const text = (el.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: text.slice(0, max), truncated: text.length > max };
}

// Numbers every visible button, link and field, so the agent can say "click 12" instead of writing selectors.
// The numbers are stored on the elements (data-md-ref) and stay valid until the page redraws them.
function pageElements(filter, max) {
  const want = (filter || '').toLowerCase();
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, [contenteditable="true"], [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=switch], [role=textbox], [role=combobox], [role=listitem], [role=row], [tabindex="0"]';
  document.querySelectorAll('[data-md-ref]').forEach((el) => el.removeAttribute('data-md-ref'));
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.innerText || el.value || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const kind = el.getAttribute('role') || (el.isContentEditable ? 'textbox' : el.tagName.toLowerCase() + (el.type && el.tagName === 'INPUT' ? ':' + el.type : ''));
    if (want && !(label.toLowerCase().includes(want) || kind.includes(want))) continue;
    el.setAttribute('data-md-ref', String(++n));
    out.push({ ref: n, kind, label, ...(el.href ? { href: el.href } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

function pageFocus(ref) {
  const el = document.querySelector(`[data-md-ref="${ref}"]`);
  if (!el) return { error: `Element ${ref} is gone (the page has changed). List the elements again.` };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus();
  if (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName)) {
    // Put the caret at the end, so typing adds to what's there; clear: true in the tool empties it first.
    const s = getSelection(), rg = document.createRange();
    if (el.isContentEditable) { rg.selectNodeContents(el); rg.collapse(false); s.removeAllRanges(); s.addRange(rg); }
  }
  return { ok: true, editable: el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) };
}

function pageClear(ref) {
  const el = document.querySelector(`[data-md-ref="${ref}"]`);
  if (!el) return;
  el.focus();
  if (el.isContentEditable) { document.execCommand('selectAll'); document.execCommand('delete'); }
  else if ('value' in el) { el.select?.(); document.execCommand('delete'); }
}

// Mouse down, up and click at the element's middle, the way WhatsApp, Notion and Gmail expect a real click.
function pageClick(ref) {
  const el = document.querySelector(`[data-md-ref="${ref}"]`);
  if (!el) return { error: `Element ${ref} is gone (the page has changed). List the elements again.` };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.focus?.();
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  return { ok: true };
}

/* ---------- what the bridge calls ---------- */

// Which tabs are on screen. Hidden webviews still report themselves visible, so ask the Monodesk window instead:
// it hides apps with visibility:hidden (keeping their layout), which the webview inherits.
async function showingIds() {
  const hosts = new Set(views().map((c) => c.hostWebContents).filter(Boolean));
  const ids = new Set();
  for (const h of hosts) {
    const list = await h.executeJavaScript(`[...document.querySelectorAll('webview')].filter((w) => w.offsetParent && w.getBoundingClientRect().width > 0 && getComputedStyle(w).visibility === 'visible').map((w) => { try { return w.getWebContentsId(); } catch { return 0; } })`).catch(() => []);
    list.forEach((id) => ids.add(id));
  }
  return ids;
}

// A hidden tab draws no frames, so pages like WhatsApp never fill in their message lists. While a job runs, the tab is
// laid over the one you're looking at at 1% opacity, then hidden again. Chromium throttles a tab that's covered or at
// opacity 0 to about one frame a second; at 1% it draws normally. .view's pointer-events:none keeps clicks going through.
async function awake(c, job) {
  const host = c.hostWebContents;
  const flip = (on) => host?.executeJavaScript(`(() => {
    const w = [...document.querySelectorAll('webview')].find((w) => { try { return w.getWebContentsId() === ${c.id}; } catch { return false; } });
    if (!w) return false;
    if (${on}) { if (getComputedStyle(w).visibility === 'visible') return false; w.dataset.mdAwake = '1'; w.style.visibility = 'visible'; w.style.opacity = '0.01'; w.style.zIndex = '5'; return true; }
    if (w.dataset.mdAwake) { delete w.dataset.mdAwake; w.style.visibility = ''; w.style.opacity = ''; w.style.zIndex = ''; }
    return false;
  })()`).catch(() => false);
  const flipped = await flip(true);
  if (flipped) await new Promise((r) => setTimeout(r, 400)); // a few frames to draw what it skipped
  try { return await job(); } finally { if (flipped) await flip(false); }
}

async function tabs() {
  const on = await showingIds();
  return { tabs: views().map((c) => ({ id: c.id, app: appOf(c.getURL()), title: c.getTitle(), url: c.getURL(), showing: on.has(c.id) })) };
}

async function read(id, selector, max) {
  const r = await run(view(id), pageText, selector || '', Math.min(Math.max(parseInt(max, 10) || 20000, 500), 200000));
  if (r.error) throw fail(r.error, 404);
  return r;
}

async function elements(id, filter, max) {
  const c = view(id);
  return { tab: c.id, url: c.getURL(), elements: await run(c, pageElements, filter || '', Math.min(Math.max(parseInt(max, 10) || 150, 1), 1000)) };
}

async function click(id, ref) {
  const r = await run(view(id), pageClick, parseInt(ref, 10));
  if (r.error) throw fail(r.error, 409);
  return r;
}

// Real keyboard input from Electron (insertText), so React-based editors like Notion and WhatsApp take it as typing.
async function type(id, ref, text, { clear = false, enter = false } = {}) {
  const c = view(id);
  if (ref !== undefined && ref !== null && ref !== '') {
    const r = await run(c, pageFocus, parseInt(ref, 10));
    if (r.error) throw fail(r.error, 409);
    if (clear) await run(c, pageClear, parseInt(ref, 10));
  }
  await c.insertText(String(text || ''));
  if (enter) await press(id, 'Enter');
  return { ok: true };
}

const KEYS = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Space']);
// "Enter", "Escape", "Ctrl+K", "Shift+Enter", "Ctrl+Shift+E", or a single character.
async function press(id, combo) {
  const c = view(id);
  const parts = String(combo || '').split('+').map((s) => s.trim()).filter(Boolean);
  let key = parts.pop() || '';
  key = { Esc: 'Escape', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space' }[key] || key;
  if (!KEYS.has(key) && key.length !== 1) throw fail(`I don't know the key “${key}”.`);
  const modifiers = parts.map((m) => ({ ctrl: 'control', control: 'control', cmd: 'meta', meta: 'meta', alt: 'alt', shift: 'shift' }[m.toLowerCase()])).filter(Boolean);
  c.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
  if (key.length === 1 && !modifiers.some((m) => m === 'control' || m === 'meta' || m === 'alt')) c.sendInputEvent({ type: 'char', keyCode: key, modifiers });
  c.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
  return { ok: true };
}

// A PNG of the tab as it is now. Tabs that aren't showing may come back blank: open that app in Monodesk first.
async function screenshot(id) {
  const c = view(id);
  const img = (await showingIds()).has(c.id) ? await c.capturePage().catch(() => null) : null;
  if (!img || img.isEmpty()) throw fail('That tab isn’t on screen, so there’s nothing to capture. Show that app in Monodesk first.', 409);
  return { png: img.toPNG().toString('base64') };
}

// Only to the apps' own sites, so a page can't steer a tab off to somewhere you're not signed in.
async function navigate(id, url) {
  const c = view(id);
  let u;
  try { u = new URL(String(url)); } catch { throw fail('That isn’t a link.'); }
  if (u.protocol !== 'https:' || appOf(u.href) !== appOf(c.getURL())) throw fail(`Tab ${c.id} is ${appOf(c.getURL())}; it only goes to links on that site.`);
  await c.loadURL(u.href);
  return { ok: true, url: c.getURL() };
}

// Runs a JavaScript expression (or an async function body with return) in the page and returns the result as JSON.
async function script(id, code) {
  const c = view(id);
  code = String(code || '');
  if (!code.trim()) throw fail('No script to run.');
  const wrapped = `(async () => { const __r = await (async () => { ${/\breturn\b/.test(code) ? code : 'return (' + code + ')'} })(); try { return JSON.parse(JSON.stringify(__r ?? null)); } catch { return String(__r); } })()`;
  try {
    return { result: await c.executeJavaScript(wrapped, true) };
  } catch (e) {
    throw fail('The script failed: ' + (e.message || e), 422);
  }
}

const woken = (fn) => (id, ...args) => awake(view(id), () => fn(id, ...args));

module.exports = {
  tabs, screenshot, navigate, awake,
  read: woken(read), elements: woken(elements), click: woken(click), type: woken(type), press: woken(press), script: woken(script),
};
