// WhatsApp for the bridge (and the Monodesk MCP server that sits on top of it).
// Works inside the WhatsApp tab that's already signed in, so nothing logs in anywhere new. It can list chats, read
// one chat's recent messages, and send a message to one chat. Reading or sending opens the chat in WhatsApp for a
// moment, the same as clicking it, so WhatsApp may mark it read; afterwards the chat you had open is opened again.
const { webContents, session } = require('electron');
const { awake } = require('./agent');

/* ---------- scripts that run inside WhatsApp Web ---------- */
// Each is passed to executeJavaScript as source, so it must be self-contained.

// Every chat row the sidebar has loaded: name, last message preview, unread count.
function pageListChats() {
  const side = document.querySelector('#pane-side');
  if (!side) return null;
  let rows = side.querySelectorAll('[role="listitem"]');
  if (!rows.length) rows = side.querySelectorAll('[role="row"]');
  const seen = new Set(), out = [];
  rows.forEach((r) => {
    const titles = [...r.querySelectorAll('span[title]')].map((s) => s.getAttribute('title')).filter(Boolean);
    const name = titles[0];
    if (!name || seen.has(name)) return;
    seen.add(name);
    const badge = r.querySelector('[aria-label*="unread message" i]');
    out.push({ name, preview: titles.length > 1 ? titles[titles.length - 1] : '', unread: badge ? parseInt(badge.textContent, 10) || 1 : 0 });
  });
  return out;
}

// The name of the chat that's open, as the sidebar spells it.
function pageOpenChatName() {
  const sel = document.querySelector('#pane-side [aria-selected="true"] span[title]');
  if (sel) return sel.getAttribute('title');
  const h = document.querySelector('#main header');
  return (h && ([...h.querySelectorAll('span[title]')].map((s) => s.getAttribute('title')).find(Boolean) || h.querySelector('span[dir="auto"]')?.innerText?.trim())) || null;
}

// Opens the chat with this name and waits until its header shows it. If it has scrolled out of the sidebar, finds it
// with WhatsApp's search, then clears the search again. Returns the name WhatsApp shows, or an error.
async function pageOpenChat(name) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const want = name.trim().toLowerCase();
  const spans = () => [...(document.querySelector('#pane-side')?.querySelectorAll('span[title]') || [])];
  const find = () => spans().find((s) => s.getAttribute('title').trim().toLowerCase() === want)
    || spans().find((s) => s.getAttribute('title').toLowerCase().includes(want));
  const press = (el) => {
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.x + 10, clientY: r.y + 8 };
    for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, opts));
  };
  // The selected sidebar row: a group's header has its members as the first title and its name without emoji.
  const header = () => {
    const sel = document.querySelector('#pane-side [aria-selected="true"] span[title]');
    if (sel) return sel.getAttribute('title');
    const h = document.querySelector('#main header');
    return h && ([...h.querySelectorAll('span[title]')].map((s) => s.getAttribute('title')).find(Boolean) || h.querySelector('span[dir="auto"]')?.innerText?.trim());
  };
  let span = find(), searched = false;
  const search = document.querySelector('#side [contenteditable="true"]');
  if (!span && search) {
    searched = true;
    search.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, name);
    for (let i = 0; i < 16 && !span; i++) { await sleep(250); span = find(); }
  }
  const clearSearch = () => {
    if (!searched || !search) return;
    search.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
  };
  if (!span) { clearSearch(); return { error: `Couldn’t find a chat called “${name}” in WhatsApp.` }; }
  const title = span.getAttribute('title');
  press(span);
  for (let i = 0; i < 25 && header() !== title; i++) await sleep(200);
  clearSearch();
  return header() === title ? { name: title } : { error: `WhatsApp didn’t open “${title}”.` };
}

// The open chat's most recent messages, oldest first. Scrolls up to load older ones when asked for more.
async function pageReadOpenChat(limit) {
  const main = document.querySelector('#main');
  if (!main) return { error: 'No chat is open in WhatsApp.' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nodes = () => main.querySelectorAll('[data-pre-plain-text]');
  let scroller = nodes()[0]?.parentElement;
  while (scroller && scroller !== main) {
    const oy = getComputedStyle(scroller).overflowY;
    if (scroller.scrollHeight > scroller.clientHeight + 10 && (oy === 'auto' || oy === 'scroll')) break;
    scroller = scroller.parentElement;
  }
  if (scroller && scroller !== main) {
    let last = nodes().length, stale = 0;
    for (let i = 0; i < 60 && last < limit && stale < 4; i++) {
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
  // data-pre-plain-text is "[3:41 pm, 22/10/2026] Nick: "
  const messages = [...nodes()].map((n) => {
    const meta = (n.getAttribute('data-pre-plain-text') || '').trim();
    const m = /^\[([^\]]*)\]\s*(.*?):?\s*$/.exec(meta) || [];
    const parts = n.querySelectorAll('span.selectable-text');
    return { when: m[1] || '', from: m[2] || '', text: parts.length ? textOf(parts[parts.length - 1]) : '[media]' };
  });
  return { messages: messages.slice(-limit) };
}

// Types this message into the open chat (which must be `name`) and sends it. Each line goes in separately with
// Shift+Enter between, the way WhatsApp's own box makes new lines. Same steps as Home's Reply box.
async function pageSendToOpenChat(name, text) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const open = document.querySelector('#pane-side [aria-selected="true"] span[title]')?.getAttribute('title');
  if (open !== name) return { error: `WhatsApp didn’t open “${name}”, so nothing was sent.` };
  const box = document.querySelector('#main footer [contenteditable="true"]');
  if (!box) return { error: `“${name}” has no message box (you may not be allowed to post there).` };
  box.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  text.split('\n').forEach((line, i) => {
    if (i) box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    if (line) document.execCommand('insertText', false, line);
  });
  await sleep(250);
  if (!box.innerText.trim()) return { error: 'Couldn’t type into WhatsApp, so nothing was sent.' };
  const send = document.querySelector('#main footer button[aria-label="Send" i]') || document.querySelector('#main footer [data-icon*="send"]')?.closest('button,[role="button"]');
  if (send) send.click();
  else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
  for (let i = 0; i < 15 && box.innerText.trim(); i++) await sleep(200);
  if (box.innerText.trim()) {
    // Don't leave a half-sent draft sitting in the box.
    box.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
    return { error: 'WhatsApp didn’t take the message, so nothing was sent.' };
  }
  return { ok: true };
}

/* ---------- running them ---------- */
// The WhatsApp tab's page. WhatsApp allows one open window, so there's only ever one.
function waPage() {
  const part = session.fromPartition('persist:wa');
  return webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getType() === 'webview' && c.session === part && /^https:\/\/web\.whatsapp\.com/.test(c.getURL()));
}

function fail(message, status = 503) {
  return Object.assign(new Error(message), { status });
}

async function run(fn, ...args) {
  const c = waPage();
  if (!c) throw fail('WhatsApp isn’t open in Monodesk (it may be asleep). Wake it there first.');
  return c.executeJavaScript(`(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`, true);
}

// One read at a time, so two callers never fight over which chat is open.
// The tab is kept drawing while the job runs, or a hidden WhatsApp never loads the chat's messages.
let queue = Promise.resolve();
const one = (job) => {
  const woke = () => { const c = waPage(); return c ? awake(c, job) : job(); };
  return (queue = queue.then(woke, woke));
};

async function chats() {
  const list = await run(pageListChats);
  if (list === null) throw fail('WhatsApp is still loading in Monodesk.');
  return { chats: list };
}

async function readChat(name, limit = 60) {
  name = String(name || '').trim();
  if (!name) throw fail('Say which chat to read.', 400);
  limit = Math.min(Math.max(parseInt(limit, 10) || 60, 1), 500);
  return one(async () => {
    const before = await run(pageOpenChatName).catch(() => null);
    const opened = await run(pageOpenChat, name);
    if (opened.error) throw fail(opened.error, 404);
    try {
      const r = await run(pageReadOpenChat, limit);
      if (r.error) throw fail(r.error);
      return { chat: opened.name, count: r.messages.length, messages: r.messages };
    } finally {
      // Put back the chat that was open before, so the screen looks the way you left it.
      if (before && before !== opened.name) await run(pageOpenChat, before).catch(() => {});
    }
  });
}

// Sends only to the chat whose name matches exactly (ignoring case), so a partial name can't land in the wrong chat.
async function sendMessage(name, text) {
  name = String(name || '').trim();
  text = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!name) throw fail('Say which chat to send to.', 400);
  if (!text) throw fail('Nothing to send.', 400);
  if (text.length > 4000) throw fail('That message is too long for one WhatsApp message (4000 characters at most).', 400);
  return one(async () => {
    const before = await run(pageOpenChatName).catch(() => null);
    const opened = await run(pageOpenChat, name);
    if (opened.error) throw fail(opened.error, 404);
    try {
      if (opened.name.trim().toLowerCase() !== name.toLowerCase()) {
        throw fail(`The closest chat is “${opened.name}”. To send there, use that exact name.`, 409);
      }
      const r = await run(pageSendToOpenChat, opened.name, text);
      if (r.error) throw fail(r.error, 502);
      return { ok: true, chat: opened.name };
    } finally {
      if (before && before !== opened.name) await run(pageOpenChat, before).catch(() => {});
    }
  });
}

module.exports = { chats, readChat, sendMessage };
