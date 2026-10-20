const $ = (s, r = document) => r.querySelector(s);
// Personal settings live in config.js.
const CFG = window.MONODESK_CONFIG || {};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const APPS = {
  home: { name: 'Home' },
  mail: { name: 'Mail', url: 'https://mail.google.com/mail/u/0/', tabs: true },
  notion: { name: 'Notion', url: 'https://www.notion.so/', tabs: true },
  claude: { name: 'Claude', url: 'https://claude.ai/', tabs: true },
  // WhatsApp Web only allows one open window, so it gets no tabs.
  wa: { name: 'WhatsApp', url: 'https://web.whatsapp.com/', tabs: false },
};
const ORDER = ['home', 'mail', 'notion', 'claude', 'wa'];
// Ctrl 1–6. Claude takes two numbers: Co-work and Claude Code.
const SLOTS = ['home', 'mail', 'notion', 'cowork', 'code', 'wa'];
const SLOT_NAMES = { cowork: 'Co-work', code: 'Claude Code' };
const goSlot = (s) => (s === 'cowork' || s === 'code' ? claudeMode(s) : go(s));
const WEB = ORDER.filter((m) => APPS[m].url);
const MAX_TABS = 12;

const P = {
  home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  notion: '<path d="M4.5 5.2L16 4l3.5 3v12.6L8 20.3l-3.5-3.7z"/><path d="M4.5 5.2L8 8.4l11.5-1.4M8 8.4v11.9"/><path d="M10.8 17.4v-6.2l5.2 6.4v-6.8"/>',
  claude: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
  wa: '<path d="M4 5h16v11H9l-5 4z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  fwd: '<path d="M9 5l7 7-7 7"/>',
  reload: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>',
  pin: '<path d="M9 4h6l-1 6 4 3H6l4-3zM12 13v7"/>',
};
const I = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;

const store = {
  get(k, d) { try { const v = localStorage.getItem('md.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('md.' + k, JSON.stringify(v)); } catch {} },
};

const S = {
  panes: store.get('panes', ['home']).filter((m) => APPS[m]).slice(0, 2),
  focus: 0,
  mode: store.get('mode', 'mono'),
  unread: { mail: 0, wa: 0 },
  tabs: {},
  active: {},
};
if (!S.panes.length) S.panes = ['home'];

document.body.classList.toggle('darwin', window.md?.platform === 'darwin');
const homeEl = $('#v-home');

/* ---------- tabs ---------- */
const countFromTitle = (t) => { const m = /\((\d[\d,]*)\)/.exec(t || ''); return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0; };
const cleanTitle = (m, t) => {
  let s = (t || '').replace(/^\(\d[\d,]*\)\s*/, '').replace(/\s[-–|]\s(Gmail|Claude|Notion|WhatsApp)$/i, '');
  if (m === 'mail') s = s.replace(/\s-\s\S+@\S+$/, '');
  return s.trim() || APPS[m].name;
};
const activeTab = (m) => S.tabs[m]?.[S.active[m]];
const activeWv = (m) => activeTab(m)?.wv;

function saveTabs() {
  const urls = {}, active = {};
  for (const m of WEB) { urls[m] = S.tabs[m].map((t) => t.url); active[m] = S.active[m]; }
  store.set('tabs', urls);
  store.set('active', active);
}

function createTab(m, url) {
  const wv = document.createElement('webview');
  const tab = { wv, url: url || APPS[m].url, title: APPS[m].name };
  wv.className = 'view';
  wv.dataset.mod = m;
  wv.setAttribute('partition', 'persist:' + m);
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('src', tab.url);
  wv.addEventListener('focus', () => setFocus(S.panes.indexOf(m)));
  wv.addEventListener('page-title-updated', (e) => {
    tab.title = cleanTitle(m, e.title);
    if ((m === 'mail' || m === 'wa') && S.tabs[m][0] === tab) {
      const n = countFromTitle(e.title);
      if (n !== S.unread[m]) { S.unread[m] = n; refreshSoon(m); }
    }
    topbar();
  });
  const nav = (e) => { if (/^https?:/.test(e.url || '')) { tab.url = e.url; saveTabs(); if (m === 'claude') topbar(); } };
  wv.addEventListener('did-navigate', nav);
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame !== false) nav(e); });
  $('#stage').appendChild(wv);
  S.tabs[m].push(tab);
  return tab;
}

function newTab(m, url) {
  if (!APPS[m]?.tabs) { if (url) activeWv(m).loadURL(url); return go(m); }
  if (S.tabs[m].length >= MAX_TABS) { toast(`${APPS[m].name} has ${MAX_TABS} tabs open. Close one first.`); return go(m); }
  createTab(m, url);
  S.active[m] = S.tabs[m].length - 1;
  saveTabs();
  go(m);
}

function closeTab(m, i) {
  const list = S.tabs[m];
  if (list.length <= 1) return;
  const [t] = list.splice(i, 1);
  t.wv.remove();
  if (S.active[m] >= list.length || S.active[m] > i) S.active[m] = Math.max(0, S.active[m] - 1);
  saveTabs();
  layout();
}

function selectTab(m, i) {
  S.active[m] = i;
  saveTabs();
  go(m);
}

/* ---------- layout ---------- */
function place(el, slot, visible) {
  const split = S.panes.length > 1;
  const shown = slot >= 0 && visible;
  el.classList.toggle('shown', shown);
  el.classList.toggle('split', split && shown);
  el.classList.toggle('focus', split && shown && slot === S.focus);
  el.classList.toggle('right', split && shown && slot === 1);
  el.style.left = split && slot === 1 ? '50%' : '0';
  el.style.width = split && slot >= 0 ? '50%' : '100%';
}

function layout() {
  place(homeEl, S.panes.indexOf('home'), true);
  for (const m of WEB) S.tabs[m].forEach((t, i) => place(t.wv, S.panes.indexOf(m), i === S.active[m]));
  if (S.panes.includes('home')) refreshHome();
  const ct = activeTab('claude');
  if (ct) claudeLast[sideOf(ct)] = S.active.claude;
  if (ct && S.panes.includes('claude')) ct.ready = false;
  topbar();
  store.set('panes', S.panes);
}

function setFocus(i) {
  if (i < 0 || i === S.focus) return;
  S.focus = i;
  layout();
}

function go(m) {
  const at = S.panes.indexOf(m);
  if (at >= 0) S.focus = at;
  else S.panes[S.focus] = m;
  layout();
  if (m !== 'home') activeWv(m)?.focus();
}

function toggleSplit() {
  if (S.panes.length > 1) {
    S.panes = [S.panes[S.focus]];
    S.focus = 0;
  } else {
    S.panes.push(S.panes[0] === 'claude' ? 'mail' : 'claude');
    S.focus = 1;
  }
  layout();
}

function openBeside(m) {
  if (S.panes.includes(m)) return go(m);
  if (S.panes.length === 1 && window.innerWidth >= 1100) {
    S.panes.push(m);
    S.focus = 1;
    layout();
  } else go(m);
}

function setMode(mode) {
  S.mode = mode;
  if (mode === 'color') document.documentElement.dataset.mode = 'color';
  else delete document.documentElement.dataset.mode;
  store.set('mode', mode);
  window.md?.setMode(mode);
  topbar();
}

/* ---------- top bar ---------- */
function topbar() {
  const cur = S.panes[S.focus];
  const split = S.panes.length > 1;
  const apps = ORDER.map((m) => {
    const n = S.unread[m] || 0;
    const cls = m === cur ? 'on' : S.panes.includes(m) ? 'shown' : '';
    // Claude gets two buttons, one for each side of claude.ai. The lit one is whichever the open Claude tab is on.
    if (m === 'claude') {
      const code = isCodeUrl(activeTab('claude')?.url);
      const c = (which) => (code === (which === 'code') ? cls : '');
      const ready = (which) => { const r = S.tabs.claude.filter((t) => t.ready && sideOf(t) === which).length; return r ? `<span class="dot">${r}</span>` : ''; };
      return `<button class="abtn ${c('cowork')}" data-act="claude-mode" data-which="cowork" data-mod="claude" title="Co-work  (Ctrl ${SLOTS.indexOf('cowork') + 1} · Alt 1–9 for recent chats)">${I('claude')}${ready('cowork')}</button>`
        + `<button class="abtn ${c('code')}" data-act="claude-mode" data-which="code" data-mod="claude" title="Claude Code  (Ctrl ${SLOTS.indexOf('code') + 1} · Alt 1–9 for recent sessions)">${I('term')}${ready('code')}</button>`;
    }
    return `<button class="abtn ${cls}" data-act="go" data-mod="${m}" title="${APPS[m].name}  (Ctrl ${SLOTS.indexOf(m) + 1})">${I(m)}${n ? `<span class="dot">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
  }).join('') + (TODO_DB ? `<button class="abtn" data-act="add-todo" title="New ${esc(TODO_GROUP)} to-do">${I('plus')}</button>` : '');

  let mid = '';
  if (split) {
    mid += '<span class="sep"></span>' + S.panes.map((m, i) => `<button class="chip ${i === S.focus ? 'on' : ''}" data-mod="${m}" data-act="focus" data-i="${i}">${APPS[m].name}<span class="x" data-act="close" data-i="${i}" title="Close this side">${I('x')}</span></button>`).join('');
  }
  if (APPS[cur]?.tabs) {
    const list = S.tabs[cur];
    if (list.length > 1 || cur === 'notion') {
      mid += '<span class="sep"></span>' + list.map((t, i) => `<button class="ptab ${i === S.active[cur] ? 'on' : ''}" data-act="tab" data-mod="${cur}" data-i="${i}" title="${esc(t.title)}">${t.ready ? '<span class="rdot"></span>' : ''}<span class="tt">${esc(t.title)}</span>${list.length > 1 ? `<span class="x" data-act="close-tab" data-mod="${cur}" data-i="${i}" title="Close tab (Ctrl W)">${I('x')}</span>` : ''}</button>`).join('');
    }
    mid += `<button class="icbtn" data-act="new-tab" data-mod="${cur}" title="New ${APPS[cur].name} tab (Ctrl T)">${I('plus')}</button>`;
  }

  const tools = `
    ${S.panes.includes('wa') ? `<button class="searchbtn" data-act="export" title="Copy the open WhatsApp chat as text (Ctrl Shift E)">${I('copy')}Copy chat</button>` : ''}
    <button class="searchbtn" data-act="palette">${I('search')}<span class="kbd">Ctrl K</span></button>
    <button class="icbtn ${split ? 'on' : ''}" data-act="split" title="Split view (Ctrl \\)">${I('split')}</button>
    <button class="modebtn" data-act="mode" title="Switch to ${S.mode === 'mono' ? 'Color' : 'Mono'}">${S.mode === 'mono' ? 'Mono' : 'Color'}</button>`;

  $('#top').innerHTML = `<div class="mark">&#x1D578;</div><div class="apps">${apps}</div><div class="mid">${mid}</div><div class="tools">${tools}</div>`;
}

/* ---------- home ---------- */
function buildHome() {
  const d = new Date();
  const h = d.getHours();
  homeEl.innerHTML = `
    <div class="hd"><h1>${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}</h1><span class="date">${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
    <div class="quad">
      <section class="q" data-mod="wa">
        <div class="qh"><span class="ic">${I('wa')}</span>WhatsApp<span class="sub" id="wa-sub"></span><span class="sp"></span><button class="lnk" data-act="wa-pin" title="Pin the chat that's open in WhatsApp here, or unpin it">${I('pin')}</button><button class="lnk" data-act="go" data-mod="wa">Open</button></div>
        <div class="qb" id="q-wa"></div>
      </section>
      <section class="q" data-mod="mail">
        <div class="qh"><span class="ic">${I('mail')}</span>Mail<span class="sub" id="mail-sub"></span><span class="sp"></span><button class="lnk" data-act="refresh-mail" title="Check again">${I('reload')}</button><button class="lnk" data-act="go" data-mod="mail">Open</button></div>
        <div class="qb" id="q-mail"></div>
      </section>
      <section class="q" data-mod="notion">
        <div class="qh"><span class="ic">${I('notion')}</span><span class="sub" id="pin-name" style="color:var(--fg);font-weight:600"></span><span class="sp"></span><button class="lnk" data-act="pin" title="Show the page that's open in Notion here">${I('pin')}</button><button class="lnk" data-act="open-pin">Open</button></div>
        <div class="qb qweb" id="q-notion"></div>
      </section>
      <section class="q" data-mod="claude">
        <div class="qh"><span class="ic">${I('claude')}</span>Inbox triage<span class="sp"></span><button class="lnk" data-act="triage-run" title="Start a new inbox triage in this panel">Run now</button><button class="lnk" data-act="triage-open" title="Continue this chat full size in Claude">Open in Claude</button></div>
        <div class="qb qweb" id="q-triage"></div>
        <form class="askline" id="ask">
          <input id="ask-in" placeholder="Ask Claude…" autocomplete="off">
          <button class="icbtn" type="submit" title="Ask in Claude">${I('send')}</button>
        </form>
      </section>
    </div>`;

  $('#ask').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#ask-in').value.trim();
    if (q) { $('#ask-in').value = ''; askClaude(q); }
  });
  buildNotionMini();
  buildTriage();
}

/* Inbox triage: a small claude.ai chat that runs the inbox-triage skill, so its questions can be answered right on Home. */
const TRIAGE_PROMPT = CFG.triagePrompt || 'Triage my unread email: summarize what matters, then ask me yes or no on what to do with each one.';
let triage, triageSend = false;
function buildTriage() {
  const url = store.get('triageChat', null);
  if (!url) { $('#q-triage').innerHTML = blank('Press Run now to triage your inbox here.'); return; }
  mountTriage(url);
}

function mountTriage(url) {
  if (triage) { triage.loadURL(url); return; }
  $('#q-triage').innerHTML = '';
  triage = document.createElement('webview');
  triage.setAttribute('partition', 'persist:claude');
  triage.setAttribute('allowpopups', '');
  triage.setAttribute('src', url);
  triage.addEventListener('dom-ready', () => {
    triage.setZoomFactor(0.8);
    if (triageSend) { triageSend = false; triage.executeJavaScript(`(${pressSendIfWaiting})(${JSON.stringify(TRIAGE_PROMPT)})`).catch(() => {}); }
  });
  const nav = (e) => { if (/^https:\/\/claude\.ai\/chat\//.test(e.url || '')) store.set('triageChat', e.url); };
  triage.addEventListener('did-navigate', nav);
  triage.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame !== false) nav(e); });
  $('#q-triage').appendChild(triage);
}

function runTriage() {
  triageSend = true;
  mountTriage('https://claude.ai/new?q=' + encodeURIComponent(TRIAGE_PROMPT));
}

// Runs inside claude.ai: if ?q= only filled in the message, press send. Gives up once the chat has started or after 15 seconds.
async function pressSendIfWaiting(text) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);
  for (let i = 0; i < 30; i++) {
    if (!location.pathname.startsWith('/new')) return 'started';
    const box = document.querySelector('[contenteditable="true"]');
    const btn = document.querySelector('button[aria-label*="send" i]');
    if (box && btn && !btn.disabled && box.innerText.includes(text)) { btn.click(); return 'sent'; }
    await sleep(500);
  }
  return 'gave up';
}

function openTriageInClaude() {
  const url = triage?.getURL();
  if (url && /^https:\/\/claude\.ai\/chat\//.test(url)) newTab('claude', url);
  else go('claude');
}

/* Notion: a small live copy of one pinned page. Clicking a link in it opens that page as a Notion tab. */
let mini, miniSettled = 0;
const pageId = (u) => (/([0-9a-f]{32})(?:[?#/]|$)/i.exec(String(u || '').replace(/-/g, '')) || [])[1];
function buildNotionMini() {
  const pin = store.get('notionPin', null);
  $('#pin-name').textContent = pin?.title || 'Notion · pin a page with the pin button';
  mini = document.createElement('webview');
  mini.setAttribute('partition', 'persist:notion');
  mini.setAttribute('allowpopups', '');
  mini.setAttribute('src', pin?.url || APPS.notion.url);
  mini.addEventListener('dom-ready', () => mini.setZoomFactor(0.72));
  mini.addEventListener('did-start-loading', () => { miniSettled = 0; });
  mini.addEventListener('did-stop-loading', () => { miniSettled = Date.now() + 2500; });
  mini.addEventListener('did-navigate-in-page', (e) => {
    const p = store.get('notionPin', null);
    if (!p || !miniSettled || Date.now() < miniSettled) return;
    const a = pageId(e.url), b = pageId(p.url);
    if (a && b && a !== b) { newTab('notion', e.url); mini.loadURL(p.url); }
  });
  $('#q-notion').appendChild(mini);
}

function pinNotionPage() {
  const t = activeTab('notion');
  if (!t || !pageId(t.url)) { toast('Open a page in Notion first, then press the pin.'); return; }
  store.set('notionPin', { url: t.url, title: t.title });
  $('#pin-name').textContent = t.title;
  mini.loadURL(t.url);
  toast(`Pinned “${t.title}” to Home`);
}

const blank = (msg = '') => `<div class="blank">${esc(msg)}</div>`;

// Runs inside WhatsApp Web: the chats in the sidebar that show an unread badge, plus each pinned chat's row whether it's unread or not.
function readUnreadChats(pinned) {
  const side = document.querySelector('#pane-side');
  if (!side) return null;
  let rows = side.querySelectorAll('[role="listitem"]');
  if (!rows.length) rows = side.querySelectorAll('[role="row"]');
  const want = new Set(pinned || []);
  const seen = new Set(), out = [], pins = {};
  rows.forEach((r) => {
    const badge = r.querySelector('[aria-label*="unread message" i]');
    const titles = [...r.querySelectorAll('span[title]')].map((s) => s.getAttribute('title')).filter(Boolean);
    const name = titles[0] || 'Chat';
    const chat = { name, preview: titles.length > 1 ? titles[titles.length - 1] : '', n: badge ? parseInt(badge.textContent, 10) || 1 : 0 };
    if (want.has(name)) { pins[name] = pins[name] || chat; return; }
    if (!badge || seen.has(name)) return;
    seen.add(name);
    out.push(chat);
  });
  return { unread: out, pins };
}

// Runs inside WhatsApp Web: the name of the chat that's open, as the sidebar spells it.
function readOpenChatName() {
  const sel = document.querySelector('#pane-side [aria-selected="true"] span[title]');
  if (sel) return sel.getAttribute('title');
  return document.querySelector('#main header span[dir="auto"]')?.innerText?.trim() || null;
}

// The pin button adds the open chat to the pinned list, or takes it off if it's already there.
async function pinWAChat() {
  let name = null;
  try { name = await S.tabs.wa[0].wv.executeJavaScript(`(${readOpenChatName})()`); } catch {}
  if (!name) { toast('Open a chat in WhatsApp first, then press the pin.'); return; }
  const pins = store.get('waPins', []);
  if (pins.includes(name)) {
    store.set('waPins', pins.filter((p) => p !== name));
    toast(`Unpinned “${name}”`);
  } else {
    store.set('waPins', [...pins, name]);
    toast(`Pinned “${name}” to Home`);
  }
  refreshWA();
}

// Runs inside WhatsApp Web: opens the chat with this name. If it has scrolled out of the sidebar, finds it with WhatsApp's search.
async function openChatByName(name) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const find = () => [...(document.querySelector('#pane-side')?.querySelectorAll('span[title]') || [])].find((s) => s.getAttribute('title') === name);
  const press = (el) => {
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.x + 10, clientY: r.y + 8 };
    for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, opts));
  };
  let span = find();
  if (!span) {
    const search = document.querySelector('#side [contenteditable="true"]');
    if (!search) return false;
    search.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, name);
    for (let i = 0; i < 12 && !span; i++) { await sleep(250); span = find(); }
    if (!span) return false;
  }
  press(span);
  return true;
}

// Runs inside WhatsApp Web: opens the chat, checks it really is that chat, types the message and sends it.
async function sendToChat(name, text) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!(await openChatByName(name))) return { error: `Couldn’t find “${name}” in WhatsApp.` };
  const header = () => {
    const h = document.querySelector('#main header');
    return h && ([...h.querySelectorAll('span[title]')].map((s) => s.getAttribute('title')).find(Boolean) || h.querySelector('span[dir="auto"]')?.innerText?.trim());
  };
  for (let i = 0; i < 20 && header() !== name; i++) await sleep(200);
  if (header() !== name) return { error: `WhatsApp didn’t open “${name}”, so nothing was sent.` };
  const box = document.querySelector('#main footer [contenteditable="true"]');
  if (!box) return { error: 'This chat has no message box.', compose: true };
  box.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  // Each line goes in separately with Shift+Enter between, the way WhatsApp's own box makes new lines.
  text.split('\n').forEach((line, i) => {
    if (i) box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    if (line) document.execCommand('insertText', false, line);
  });
  await sleep(250);
  if (!box.innerText.trim()) return { error: 'Couldn’t type into WhatsApp from Home.', compose: true };
  const send = document.querySelector('#main footer button[aria-label="Send" i]') || document.querySelector('#main footer [data-icon*="send"]')?.closest('button,[role="button"]');
  if (send) send.click();
  else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
  for (let i = 0; i < 15 && box.innerText.trim(); i++) await sleep(200);
  return box.innerText.trim() ? { error: 'The message is typed in WhatsApp but didn’t send.', compose: true } : { ok: true };
}

// Runs inside WhatsApp Web: right-clicks the chat in the sidebar and picks "Mark as read".
async function markChatRead(name) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const span = [...(document.querySelector('#pane-side')?.querySelectorAll('span[title]') || [])].find((el) => el.getAttribute('title') === name);
  if (!span) return 'missing';
  const row = span.closest('[role="listitem"], [role="row"]') || span;
  const r = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, button: 2, clientX: r.x + 20, clientY: r.y + 10 }));
  for (let i = 0; i < 12; i++) {
    await sleep(150);
    const item = [...document.querySelectorAll('li, [role="button"], [role="menuitem"]')].filter((el) => /^mark as read$/i.test(el.innerText?.trim() || '')).pop();
    if (item) { item.click(); return 'ok'; }
  }
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  return 'nomenu';
}

async function markWARead(name) {
  let res = null;
  try { res = await S.tabs.wa[0].wv.executeJavaScript(`(${markChatRead})(${JSON.stringify(name)})`, true); } catch {}
  if (res === 'ok') { toast(`Marked “${name}” as read`); setTimeout(refreshWA, 700); }
  else toast(res === 'missing' ? `“${name}” isn’t in WhatsApp’s chat list right now.` : 'WhatsApp didn’t offer “Mark as read” for that chat.');
}

// A small reply box under the chat on Home. Enter sends, Shift+Enter adds a line.
function openReply(name, anchor) {
  closeLayer();
  const r = anchor.closest('.item').getBoundingClientRect();
  const w = Math.min(340, window.innerWidth - 24);
  const left = Math.min(Math.max(12, r.right - w - 8), window.innerWidth - w - 12);
  const top = Math.min(r.bottom + 4, window.innerHeight - 190);
  $('#layer').insertAdjacentHTML('beforeend', `<div class="ov lite" data-ov><form class="replypop" data-mod="wa" style="left:${left}px; top:${top}px; width:${w}px" role="dialog" aria-label="Reply on WhatsApp">
    <div class="rh">Reply to <b>${esc(name)}</b></div>
    <textarea id="reply-in" rows="3" placeholder="Message"></textarea>
    <div class="rf"><span class="hint" id="reply-hint">Enter to send · Shift Enter for a new line</span><button class="btn" type="submit">${I('send')}Send</button></div>
  </form></div>`);
  const form = $('.replypop'), ta = $('#reply-in');
  const draftKey = 'md.waDraft.' + name;
  ta.value = sessionStorage.getItem(draftKey) || '';
  ta.addEventListener('input', () => sessionStorage.setItem(draftKey, ta.value));
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    form.querySelector('button').disabled = true;
    $('#reply-hint').textContent = 'Sending…';
    let res;
    try { res = await S.tabs.wa[0].wv.executeJavaScript(`(${sendToChat})(${JSON.stringify(name)}, ${JSON.stringify(text)})`, true); } catch { res = { error: 'WhatsApp isn’t ready yet.' }; }
    if (res?.ok) {
      sessionStorage.removeItem(draftKey);
      closeLayer();
      toast(`Sent to ${name}`);
      refreshSoon('wa');
      return;
    }
    if (res?.compose) {
      // Hand it over: the chat is open in WhatsApp and the message is on the clipboard.
      window.md?.copy(text);
      closeLayer();
      go('wa');
      toast(`${res.error} It’s on your clipboard. Paste it with Ctrl V.`);
      return;
    }
    form.querySelector('button').disabled = false;
    $('#reply-hint').textContent = res?.error || 'Couldn’t send.';
  });
  $('[data-ov]').addEventListener('pointerdown', (e) => { if (e.target.matches('[data-ov]')) closeLayer(); });
  ta.focus();
}

async function refreshWA() {
  const box = $('#q-wa');
  const pinned = store.get('waPins', []);
  let r = null;
  try { r = await S.tabs.wa[0].wv.executeJavaScript(`(${readUnreadChats})(${JSON.stringify(pinned)})`); } catch {}
  if (r === null) { box.innerHTML = blank('WhatsApp is loading…'); $('#wa-sub').textContent = ''; return; }
  const list = r.unread;
  const total = list.length + pinned.filter((p) => r.pins[p]?.n).length;
  $('#wa-sub').textContent = total ? `${total} unread` : '';
  const row = (c, pin) => `<button class="item${pin ? ' pinned' : ''}" data-act="wa-open" data-name="${esc(c.name)}"><div class="t1">${pin ? I('pin') : ''}<b>${esc(c.name)}</b>${c.n ? `<span class="badge">${c.n}</span>` : ''}${c.n ? `<span class="reply" data-act="wa-read" data-name="${esc(c.name)}" title="Mark as read">Read</span>` : ''}<span class="reply" data-act="wa-reply" data-name="${esc(c.name)}" title="Reply without leaving Home">Reply</span></div><div class="t3">${esc(c.preview)}</div></button>`;
  // Unread chats first, then the pinned chats, which always stay. A pinned chat that has scrolled out of WhatsApp's sidebar still shows, just without its latest message.
  const pins = pinned.map((p) => row(r.pins[p] || { name: p, preview: 'Not in the recent chats list right now', n: 0 }, true)).join('');
  box.innerHTML = list.map((c) => row(c)).join('') + pins || blank('Nothing unread. Open a chat in WhatsApp and press the pin to keep it here.');
}

// Runs inside Gmail: unread mail in the Primary inbox, from Gmail's own feed. Falls back to the visible inbox rows.
async function readUnreadMail() {
  const pick = (s, tag) => { const m = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>').exec(s); return m ? m[1] : ''; };
  const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const get = async (label) => { const r = await fetch('/mail/u/0/feed/atom/' + label, { credentials: 'include' }); if (!r.ok) throw new Error(r.status); return r.text(); };
  let xml = null;
  try { xml = await get('%5Esmartlabel_personal'); } catch { try { xml = await get(''); } catch {} }
  if (xml && xml.includes('<feed')) {
    return xml.split('<entry>').slice(1).map((e) => ({
      subject: dec(pick(e, 'title')),
      snippet: dec(pick(e, 'summary')),
      from: dec(pick(e, 'name')),
      email: dec(pick(e, 'email')),
      link: dec((/<link[^>]*href="([^"]*)"/.exec(e) || [])[1] || ''),
      when: pick(e, 'issued') || pick(e, 'modified'),
    }));
  }
  const rows = [...document.querySelectorAll('tr.zA.zE')];
  if (!rows.length && !document.querySelector('tr.zA')) return null;
  return rows.map((r) => ({
    subject: r.querySelector('.bog')?.innerText || '',
    snippet: (r.querySelector('.y2')?.innerText || '').replace(/^\s*-\s*/, ''),
    from: r.querySelector('[email]')?.getAttribute('name') || '',
    email: r.querySelector('[email]')?.getAttribute('email') || '',
    link: '',
    when: '',
  }));
}

// Runs inside Gmail: finds the inbox row for this mail and presses its own "Mark as read" button.
function markMailRead(id, subject) {
  const rows = [...document.querySelectorAll('tr.zA')];
  const row = (id && rows.find((r) => r.querySelector(`[data-legacy-thread-id="${id}"], [data-legacy-last-message-id="${id}"]`)))
    || (subject && rows.find((r) => r.classList.contains('zE') && (r.querySelector('.bog')?.innerText || '').trim() === subject.trim()));
  if (!row) return 'missing';
  if (!row.classList.contains('zE')) return 'ok';
  const btn = row.querySelector('li[data-tooltip="Mark as read" i], [aria-label="Mark as read" i]');
  if (!btn) return 'nobutton';
  const r = btn.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window, clientX: r.x + 4, clientY: r.y + 4 };
  for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) btn.dispatchEvent(new MouseEvent(type, opts));
  return 'ok';
}

async function markMailReadFromHome(id, subject) {
  let res = null;
  try { res = await S.tabs.mail[0].wv.executeJavaScript(`(${markMailRead})(${JSON.stringify(id)}, ${JSON.stringify(subject)})`); } catch {}
  if (res === 'ok') { toast('Marked as read'); setTimeout(refreshMail, 900); }
  else toast(res === 'missing' ? 'Show your inbox in the Mail tab, then try again.' : 'Gmail didn’t offer “Mark as read” for that email.');
}

// Signal, not noise: Primary inbox only, and skip automated senders.
const NOISE = /(no-?reply|do-?not-?reply|notification|newsletter|digest|marketing|mailer|bounce|updates?@|news@|info@|hello@|team@|support@|billing@|receipts?@|alerts?@)/i;
const shortWhen = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
async function refreshMail() {
  const box = $('#q-mail');
  let all = null;
  try { all = await S.tabs.mail[0].wv.executeJavaScript(`(${readUnreadMail})()`); } catch {}
  if (all === null) { box.innerHTML = blank('Sign in to Gmail in the Mail tab to see important unread mail here.'); $('#mail-sub').textContent = ''; return; }
  const top3 = all.filter((e) => !NOISE.test(`${e.email} ${e.from}`)).slice(0, 3);
  $('#mail-sub').textContent = all.length ? `${all.length} unread in Primary` : '';
  box.innerHTML = top3.length
    ? top3.map((e) => `<button class="item" data-act="mail-open" data-link="${esc(e.link)}"><div class="t1"><b>${esc(e.from || e.email)}</b><span class="when">${shortWhen(e.when)}</span><span class="reply" data-act="mail-read" data-id="${esc((/message_id=([0-9a-f]+)/i.exec(e.link) || [])[1] || '')}" data-subject="${esc(e.subject)}" title="Mark as read">Mark as read</span></div><div class="t2">${esc(e.subject || '(no subject)')}</div><div class="t3">${esc(e.snippet)}</div></button>`).join('')
    : blank(all.length ? 'Nothing important. The rest looks automated.' : '');
}

function refreshHome() { refreshWA(); refreshMail(); }
const refreshTimers = {};
function refreshSoon(m) {
  if (!S.panes.includes('home')) return;
  clearTimeout(refreshTimers[m]);
  refreshTimers[m] = setTimeout(() => (m === 'wa' ? refreshWA() : refreshMail()), 800);
}
setInterval(() => { if (S.panes.includes('home')) refreshHome(); }, 30000);

const CLAUDE_BUSY = `!!document.querySelector('[data-is-streaming="true"], button[aria-label*="stop" i], button[aria-label*="interrupt" i]')`;
const claudeSeen = (t) => S.panes.includes('claude') && activeTab('claude') === t && document.hasFocus();
async function pollClaude() {
  let changed = false;
  for (const t of S.tabs.claude) {
    let busy;
    try { busy = await t.wv.executeJavaScript(CLAUDE_BUSY); } catch { continue; }
    if (t.busy && !busy && !claudeSeen(t)) { t.ready = true; changed = true; }
    if (t.ready && claudeSeen(t)) { t.ready = false; changed = true; }
    t.busy = busy;
  }
  if (changed) topbar();
}
setInterval(pollClaude, 2000);

/* ---------- Claude ---------- */
function askClaude(text) {
  // claude.ai pre-fills a new chat from ?q=. The text also goes on the clipboard in case it doesn't.
  window.md?.copy(text);
  const short = text.length < 6000;
  const url = short ? 'https://claude.ai/new?q=' + encodeURIComponent(text) : COWORK_URL;
  // Asks go to a Co-work tab, never over a Claude Code session.
  const i = claudeSideTab('cowork');
  if (i >= 0) { S.active.claude = i; S.tabs.claude[i].wv.loadURL(url); saveTabs(); }
  else if (S.tabs.claude.length < MAX_TABS) { createTab('claude', url); S.active.claude = S.tabs.claude.length - 1; saveTabs(); }
  else activeWv('claude').loadURL(url);
  openBeside('claude');
  toast(short ? 'Opened in Claude. It is also on your clipboard.' : 'Copied. Press Ctrl+V in Claude to paste it.');
}

/* ---------- WhatsApp → text ---------- */
// Runs inside WhatsApp Web. Scrolls the open chat upward until it has enough messages, then reads them.
async function readOpenChat(limit) {
  const main = document.querySelector('#main');
  if (!main) return { error: 'Open a chat in WhatsApp first, then try again.' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nodes = () => main.querySelectorAll('[data-pre-plain-text]');
  const want = limit === 'all' ? 5000 : limit;
  let scroller = nodes()[0]?.parentElement;
  while (scroller && scroller !== main) {
    const oy = getComputedStyle(scroller).overflowY;
    if (scroller.scrollHeight > scroller.clientHeight + 10 && (oy === 'auto' || oy === 'scroll')) break;
    scroller = scroller.parentElement;
  }
  if (scroller && scroller !== main) {
    let last = nodes().length, stale = 0;
    for (let i = 0; i < 80 && last < want && stale < 4; i++) {
      scroller.scrollTop = 0;
      await sleep(700);
      const n = nodes().length;
      if (n === last) stale++; else { stale = 0; last = n; }
    }
    scroller.scrollTop = scroller.scrollHeight;
  }
  const textOf = (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('img[alt]').forEach((img) => img.replaceWith(img.alt));
    return c.innerText.trim();
  };
  const lines = [...nodes()].map((n) => {
    const meta = (n.getAttribute('data-pre-plain-text') || '').trim();
    const parts = n.querySelectorAll('span.selectable-text');
    const body = parts.length ? textOf(parts[parts.length - 1]) : '[media]';
    return meta + ' ' + body;
  });
  const name = main.querySelector('header span[dir="auto"]')?.innerText?.trim() || 'WhatsApp chat';
  return { name, lines: limit === 'all' ? lines : lines.slice(-limit) };
}

function formatChat(r, stamps) {
  const lines = stamps ? r.lines : r.lines.map((l) => l.replace(/^\[[^\]]*\]\s*/, ''));
  return `WhatsApp chat: ${r.name}\n${lines.length} most recent messages, oldest first\n\n${lines.join('\n')}`;
}

function openExport() {
  closeLayer();
  let limit = 100, stamps = true, result = null;
  $('#layer').insertAdjacentHTML('beforeend', `<div class="ov" data-ov><div class="exp" data-mod="wa" role="dialog" aria-label="Copy WhatsApp chat">
    <div class="eh">${I('copy')}<b id="exp-title">Copy the open WhatsApp chat</b><button class="icbtn" data-x aria-label="Close">${I('x')}</button></div>
    <div class="opts"><span>Messages</span><div class="seg" id="exp-n">${[25, 50, 100, 250, 'all'].map((n) => `<button data-n="${n}" class="${n === 100 ? 'on' : ''}">${n === 'all' ? 'All loaded' : 'Last ' + n}</button>`).join('')}</div>
      <label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="exp-ts" checked> Timestamps</label></div>
    <textarea id="exp-txt" readonly aria-label="Chat text"></textarea>
    <div class="foot"><span class="cnt" id="exp-cnt"></span><button class="btn ghost" id="exp-claude" disabled>${I('claude')}Send to Claude</button><button class="btn" id="exp-copy" disabled>${I('copy')}Copy</button></div>
  </div></div>`);
  const ta = $('#exp-txt');
  const setBusy = (b) => { $('#exp-copy').disabled = b || !result; $('#exp-claude').disabled = b || !result; };
  const draw = () => {
    if (!result) return;
    ta.value = formatChat(result, stamps);
    $('#exp-title').textContent = `Copy “${result.name}” as text`;
    $('#exp-cnt').textContent = `${result.lines.length} messages · ${ta.value.length.toLocaleString()} characters`;
  };
  const fetchChat = async () => {
    setBusy(true);
    ta.value = '';
    $('#exp-cnt').textContent = 'Reading messages from WhatsApp…';
    try {
      const r = await S.tabs.wa[0].wv.executeJavaScript(`(${readOpenChat})(${JSON.stringify(limit)})`, true);
      if (r.error) { result = null; $('#exp-cnt').textContent = r.error; }
      else { result = r; draw(); }
    } catch {
      result = null;
      $('#exp-cnt').textContent = 'Could not read WhatsApp. Make sure it has finished loading.';
    }
    setBusy(false);
  };
  $('#exp-n').addEventListener('click', (e) => {
    const b = e.target.closest('[data-n]');
    if (!b) return;
    limit = b.dataset.n === 'all' ? 'all' : +b.dataset.n;
    $('#exp-n').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    fetchChat();
  });
  $('#exp-ts').addEventListener('change', (e) => { stamps = e.target.checked; draw(); });
  $('#exp-copy').addEventListener('click', async () => { await window.md?.copy(ta.value); closeLayer(); toast('Copied. Paste it into any Claude chat.'); });
  $('#exp-claude').addEventListener('click', () => {
    const t = ta.value;
    closeLayer();
    askClaude('Summarize this chat and pull out anything I need to reply to or do:\n\n' + t);
  });
  $('[data-x]').onclick = closeLayer;
  $('[data-ov]').addEventListener('pointerdown', (e) => { if (e.target.matches('[data-ov]')) closeLayer(); });
  fetchChat();
}

/* ---------- new to-do: a card in one column of your Notion to-do board (set in config.js) ---------- */
const TODO_DB = pageId(CFG.todoBoard);
const TODO_GROUP = CFG.todoColumn || 'Soon';
// Runs inside Notion: presses "+ New page" at the bottom of the board column with this name.
async function newInBoardGroup(name) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = (el) => {
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, opts));
  };
  for (let k = 0; k < 40; k++) {
    const root = document.querySelector('.notion-board-view') || document;
    const label = [...root.querySelectorAll('div, span')].find((el) => !el.children.length && el.textContent.trim() === name);
    if (label) {
      label.scrollIntoView({ block: 'nearest', inline: 'center' });
      await sleep(150);
      const lr = label.getBoundingClientRect();
      const btn = [...root.querySelectorAll('[role="button"]')]
        .filter((b) => /^\+?\s*New( page)?$/i.test(b.innerText.trim()))
        .find((b) => { const r = b.getBoundingClientRect(); return r.width && r.top > lr.top && lr.left >= r.left - 12 && lr.left <= r.right; });
      if (btn) { btn.scrollIntoView({ block: 'center' }); await sleep(120); press(btn); return 'ok'; }
    }
    await sleep(300);
  }
  return 'missing';
}

async function addTodo() {
  let i = S.tabs.notion.findIndex((t) => pageId(t.url) === TODO_DB);
  if (i >= 0) selectTab('notion', i);
  else {
    const before = S.tabs.notion.length;
    newTab('notion', 'https://www.notion.so/' + TODO_DB);
    if (S.tabs.notion.length === before) return;
    i = before;
  }
  const wv = S.tabs.notion[i].wv;
  let res = null;
  // A brand-new tab can't run scripts until its page has started loading.
  for (let k = 0; k < 20 && res === null; k++) {
    try { res = await wv.executeJavaScript(`(${newInBoardGroup})(${JSON.stringify(TODO_GROUP)})`, true); } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (res !== 'ok') toast(`Couldn’t find the “${TODO_GROUP}” column. Notion hides it while it’s empty, so add this one by hand.`);
}

/* ---------- command palette ---------- */
function compose() { activeWv('mail').loadURL('https://mail.google.com/mail/u/0/#inbox?compose=new'); go('mail'); }
function openCode() { claudeMode('code'); }
const CLAUDE_CODE_URL = 'https://claude.ai/code';
const COWORK_URL = 'https://claude.ai/new';
const isCodeUrl = (u) => /^https:\/\/claude\.ai\/code\b/.test(u || '');
const sideOf = (t) => (isCodeUrl(t?.url) ? 'code' : 'cowork');
// Co-work and Claude Code each keep their own tab, so switching sides never navigates away from what you were doing.
const claudeLast = { cowork: -1, code: -1 };
function claudeSideTab(which) {
  const list = S.tabs.claude;
  const ready = list.findIndex((t) => t.ready && sideOf(t) === which);
  if (ready >= 0) return ready;
  if (sideOf(list[S.active.claude]) === which) return S.active.claude;
  if (sideOf(list[claudeLast[which]]) === which && list[claudeLast[which]]) return claudeLast[which];
  return list.findIndex((t) => sideOf(t) === which);
}
// Shows the tab for that side, opening one only if there's none yet.
function claudeMode(which, url) {
  const i = claudeSideTab(which);
  if (i < 0) return newTab('claude', url || (which === 'code' ? CLAUDE_CODE_URL : COWORK_URL));
  S.active.claude = i;
  if (url) S.tabs.claude[i].wv.loadURL(url);
  saveTabs();
  go('claude');
}
function commands() {
  const cur = S.panes[S.focus];
  return [
    ...SLOTS.map((s, k) => ({ ic: s === 'cowork' ? 'claude' : s === 'code' ? 'term' : s, t: 'Go to ' + (SLOT_NAMES[s] || APPS[s].name), k: 'Ctrl ' + (k + 1), run: () => goSlot(s) })),
    { ic: 'plus', t: 'New Notion tab', run: () => newTab('notion') },
    { ic: 'edit', t: 'Compose email', run: compose },
    { ic: 'plus', t: 'New Claude chat', run: () => claudeMode('cowork', COWORK_URL) },
    { ic: 'term', t: 'Claude Code sessions', run: openCode },
    { ic: 'copy', t: 'Copy WhatsApp chat for Claude', k: 'Ctrl Shift E', run: openExport },
    { ic: 'pin', t: 'Pin the open Notion page to Home', run: pinNotionPage },
    { ic: 'pin', t: 'Pin the open WhatsApp chat to Home', run: pinWAChat },
    ...(TODO_DB ? [{ ic: 'plus', t: `New ${TODO_GROUP} to-do`, run: addTodo }] : []),
    { ic: 'claude', t: 'Run inbox triage', run: () => { go('home'); runTriage(); } },
    { ic: 'split', t: 'Toggle split view', k: 'Ctrl \\', run: toggleSplit },
    { ic: 'theme', t: S.mode === 'mono' ? 'Switch to Color' : 'Switch to Mono', run: () => setMode(S.mode === 'mono' ? 'color' : 'mono') },
    { ic: 'back', t: 'Back', run: () => { const w = activeWv(cur); if (w?.canGoBack()) w.goBack(); } },
    { ic: 'fwd', t: 'Forward', run: () => { const w = activeWv(cur); if (w?.canGoForward()) w.goForward(); } },
    { ic: 'reload', t: 'Reload current app', run: () => (cur === 'home' ? refreshHome() : activeWv(cur).reload()) },
  ];
}

function openPalette() {
  closeLayer();
  const all = commands();
  let sel = 0, cur = all;
  $('#layer').insertAdjacentHTML('beforeend', `<div class="ov" data-ov><div class="pal" role="dialog" aria-label="Search"><input id="pal-in" placeholder="Type a command or app name" autocomplete="off"><ul id="pal-list"></ul></div></div>`);
  const inp = $('#pal-in'), ul = $('#pal-list');
  const draw = () => { ul.innerHTML = cur.length ? cur.map((c, k) => `<li class="${k === sel ? 'on' : ''}" data-k="${k}">${I(c.ic)}<span>${esc(c.t)}</span>${c.k ? `<span class="k">${esc(c.k)}</span>` : ''}</li>`).join('') : '<li>No matches</li>'; };
  const run = (k) => { const c = cur[k]; if (!c) return; closeLayer(); c.run(); };
  inp.addEventListener('input', () => { const q = inp.value.toLowerCase().trim(); cur = q ? all.filter((c) => c.t.toLowerCase().includes(q)) : all; sel = 0; draw(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, cur.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  });
  ul.addEventListener('click', (e) => { const li = e.target.closest('li[data-k]'); if (li) run(+li.dataset.k); });
  $('[data-ov]').addEventListener('pointerdown', (e) => { if (e.target.matches('[data-ov]')) closeLayer(); });
  draw();
  inp.focus();
}

/* ---------- helpers ---------- */
let toastTimer;
function toast(msg) {
  $('#layer .toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('#layer').appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}
function closeLayer() { $('#layer .ov')?.remove(); }

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const d = b.dataset;
  switch (d.act) {
    case 'go': go(d.mod); break;
    case 'split': toggleSplit(); break;
    case 'mode': setMode(S.mode === 'mono' ? 'color' : 'mono'); break;
    case 'palette': openPalette(); break;
    case 'focus': setFocus(+d.i); break;
    case 'close': e.stopPropagation(); S.panes.splice(+d.i, 1); S.focus = 0; layout(); break;
    case 'tab': selectTab(d.mod, +d.i); break;
    case 'close-tab': e.stopPropagation(); closeTab(d.mod, +d.i); break;
    case 'new-tab': newTab(d.mod); break;
    case 'export': openExport(); break;
    case 'new-chat': claudeMode('cowork', COWORK_URL); break;
    case 'code': openCode(); break;
    case 'claude-mode': claudeMode(d.which); break;
    case 'pin': pinNotionPage(); break;
    case 'wa-pin': pinWAChat(); break;
    case 'triage-run': runTriage(); break;
    case 'triage-open': openTriageInClaude(); break;
    case 'open-pin': { const p = store.get('notionPin', null); p ? newTab('notion', p.url) : go('notion'); break; }
    case 'refresh-mail': refreshMail(); break;
    case 'mail-open': if (d.link) activeWv('mail').loadURL(d.link); go('mail'); break;
    case 'wa-reply': openReply(d.name, b); break;
    case 'wa-read': markWARead(d.name); break;
    case 'mail-read': markMailReadFromHome(d.id, d.subject); break;
    case 'add-todo': addTodo(); break;
    case 'wa-open': go('wa'); S.tabs.wa[0].wv.executeJavaScript(`(${openChatByName})(${JSON.stringify(d.name)})`).catch(() => {}); break;
  }
});
// Middle-click closes a tab, like a browser.
document.addEventListener('auxclick', (e) => {
  const t = e.button === 1 && e.target.closest('.ptab');
  if (t) closeTab(t.dataset.mod, +t.dataset.i);
});
homeEl.addEventListener('pointerdown', () => setFocus(S.panes.indexOf('home')));

function shortcut(key) {
  const cur = S.panes[S.focus];
  if (key === 'k') openPalette();
  else if (key === '\\') toggleSplit();
  else if (key === 'shift+e') openExport();
  else if (key === 't') newTab(APPS[cur]?.tabs ? cur : 'notion');
  else if (key === 'w') { if (APPS[cur]?.tabs) closeTab(cur, S.active[cur]); }
  else if (/^[1-6]$/.test(key)) goSlot(SLOTS[+key - 1]);
  else if (key.startsWith('alt')) claudeAlt(key);
}

/* Claude: hold Alt to number your recent chats (or Code sessions), Alt 1–9 to jump to one. */
// Runs inside claude.ai: 'show' numbers the recent chats in the sidebar, 'hide' clears them, 'go' opens number n.
function claudeThreads(action, n) {
  document.querySelectorAll('.md-hint').forEach((e) => e.remove());
  if (action === 'hide') return true;
  const seen = new Set();
  const links = [...document.querySelectorAll('a[href]')].filter((a) => {
    const h = a.getAttribute('href').replace(/^https:\/\/claude\.ai/, '');
    if (!/^\/(chat|code)\/[^/?#]+/.test(h) || seen.has(h)) return false;
    const r = a.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    seen.add(h);
    return true;
  }).slice(0, 9);
  if (action === 'go') { const a = links[n - 1]; if (a) a.click(); return !!a; }
  links.forEach((a, i) => {
    const r = a.getBoundingClientRect();
    const b = document.createElement('div');
    b.className = 'md-hint';
    b.textContent = i + 1;
    Object.assign(b.style, { position: 'fixed', left: Math.max(2, r.left + 4) + 'px', top: r.top + r.height / 2 - 9 + 'px', zIndex: 2147483647, minWidth: '18px', height: '18px', padding: '0 5px', borderRadius: '9px', background: '#ecebe8', color: '#121212', font: '600 11px/18px system-ui, sans-serif', textAlign: 'center', pointerEvents: 'none', boxShadow: '0 1px 4px rgba(0,0,0,.45)' });
    document.body.appendChild(b);
  });
  // Alt+Tab away leaves no numbers behind.
  const clear = () => document.querySelectorAll('.md-hint').forEach((e) => e.remove());
  window.addEventListener('blur', clear, { once: true });
  setTimeout(clear, 6000);
  return links.length;
}

let hintTimer;
function claudeAlt(key) {
  const [what, id] = key.split('@');
  const wv = [...S.tabs.claude.map((t) => t.wv), triage].find((w) => w && String(w.getWebContentsId?.()) === id) || activeWv('claude');
  const run = (action, n) => wv.executeJavaScript(`(${claudeThreads})(${JSON.stringify(action)}, ${n || 0})`).catch(() => {});
  clearTimeout(hintTimer);
  // A short wait, so a quick Alt+Tab doesn't flash numbers.
  if (what === 'alt-hold') hintTimer = setTimeout(() => run('show'), 250);
  else if (what === 'alt-up') run('hide');
  else run('go', +what.slice(4)).then((ok) => { if (ok === false) toast('Open Claude\'s sidebar to switch between recent chats.'); });
}
window.md?.onShortcut(shortcut);
window.md?.onNewTab(({ mod, url }) => {
  const id = mod === 'notion' && pageId(url);
  const open = id ? S.tabs.notion.findIndex((t) => pageId(t.url) === id) : -1;
  if (open >= 0) selectTab('notion', open);
  else newTab(mod, url);
});
window.md?.onToast(toast);
window.md?.onCssChanged(() => { $('#shell-css').href = 'style.css?v=' + Date.now(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeLayer();
  // Alt 1–9 while Claude is showing but the shell has the keyboard.
  if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key) && S.panes[S.focus] === 'claude') { e.preventDefault(); shortcut('alt+' + e.key); return; }
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (e.shiftKey && k === 'e') { e.preventDefault(); shortcut('shift+e'); }
  else if (!e.shiftKey && ['k', '\\', 't', 'w', '1', '2', '3', '4', '5', '6'].includes(k)) { e.preventDefault(); shortcut(k); }
});

/* ---------- start: reopen the tabs from last time ---------- */
const savedTabs = store.get('tabs', {});
const savedActive = store.get('active', {});
for (const m of WEB) {
  S.tabs[m] = [];
  const urls = APPS[m].tabs && savedTabs[m]?.length ? savedTabs[m].slice(0, MAX_TABS) : [APPS[m].url];
  urls.forEach((u) => createTab(m, u));
  S.active[m] = Math.min(Math.max(0, savedActive[m] || 0), S.tabs[m].length - 1);
}
buildHome();
setMode(S.mode);
layout();
