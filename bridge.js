// Monodesk Phone bridge. Serves the Dispatch phone app and a small JSON API on this computer only.
// `tailscale serve` puts it on your tailnet over HTTPS, so only your own devices can reach it.
// Claude work happens in hidden windows that share Monodesk's Claude sign-in (persist:claude).
const http = require('http');
const path = require('path');
const fs = require('fs');
const { BrowserWindow } = require('electron');
const updater = require('./updater');

const PORT = 47800;
const HOST = '127.0.0.1';
const ORIGIN = 'https://claude.ai';
// Dispatch's files (github.com/TetonTopo/dispatch): see updater.dispatchDir.
const TOP = 3;
const HISTORY = 40; // How many recent chats and Code sessions (each) the phone's list shows.
const NEW_MODEL = 'Opus 5.5'; // New chats and Code sessions from the phone always start on this model.
const KEEP_MESSAGES = 40;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

/* ---------- scripts that run inside claude.ai ---------- */
// Each is passed to executeJavaScript as source, so it must be self-contained.

// Recent Co-work chats, newest first, from claude.ai's own API (same calls the site makes).
async function pageListChats(limit) {
  const get = (u) => fetch(u, { credentials: 'include', headers: { 'anthropic-client-platform': 'web_claude_ai' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
  const orgs = await get('/api/organizations');
  const org = (orgs.find((o) => (o.capabilities || []).includes('chat')) || orgs[0])?.uuid;
  if (!org) return { error: 'signed-out' };
  const list = await get(`/api/organizations/${org}/chat_conversations?limit=${limit}`);
  return { org, items: list.map((c) => ({ id: c.uuid, title: c.name || 'New chat', updated: c.updated_at })) };
}

// One chat's messages along the branch you are on.
async function pageReadChat(org, id) {
  const get = (u) => fetch(u, { credentials: 'include', headers: { 'anthropic-client-platform': 'web_claude_ai' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
  const c = await get(`/api/organizations/${org}/chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=true`);
  const all = c.chat_messages || [];
  const byId = new Map(all.map((m) => [m.uuid, m]));
  const branch = [];
  for (let m = byId.get(c.current_leaf_message_uuid); m; m = byId.get(m.parent_message_uuid)) branch.unshift(m);
  const textOf = (m) => (Array.isArray(m.content) && m.content.length
    ? m.content.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n\n')
    : m.text || '');
  // What Claude is doing right now, as claude.ai shows it: the latest tool step ("Search Notion") or thinking summary.
  let status = null;
  const lastMsg = (branch.length ? branch : all).at(-1);
  if (lastMsg && lastMsg.sender !== 'human') {
    for (const b of [...(lastMsg.content || [])].reverse()) {
      if (b.type === 'tool_result') continue;
      if (b.type === 'tool_use') {
        let m = String(b.message || '').replace(/^[\w-]+:\s*/, '') || b.name || '';
        if (b.integration_name && !m.toLowerCase().includes(b.integration_name.toLowerCase())) m = b.integration_name + ': ' + m;
        status = m;
      } else if (b.type === 'thinking') {
        try { status = JSON.parse(b.summaries || '[]').at(-1)?.summary || 'Thinking'; } catch { status = 'Thinking'; }
      }
      break;
    }
  }
  return {
    title: c.name || 'New chat',
    updated: c.updated_at,
    status,
    messages: (branch.length ? branch : all).map((m) => ({ role: m.sender === 'human' ? 'user' : 'assistant', text: textOf(m) })).filter((m) => m.text.trim()),
  };
}

// Claude Code sessions (newest first), from the sessions API claude.ai/code uses.
// The API calls them cse_…; their pages are /code/session_… with the same suffix.
async function pageListCode(limit) {
  const r = await fetch(`/v1/code/sessions?statuses=active&statuses=paused&limit=${limit}`, { credentials: 'include', headers: { 'anthropic-beta': 'ccr-byoc-2025-07-29', 'anthropic-version': '2023-06-01', 'anthropic-client-platform': 'web_claude_ai' } });
  if (r.status === 401 || r.status === 403) return { error: 'signed-out' };
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  return {
    items: (j.data || []).map((s) => ({
      id: s.id.replace(/^cse_/, 'session_'),
      title: s.title || 'Claude Code session',
      when: Date.parse(s.last_event_at || s.updated_at) || 0,
      busy: s.status_bucket === 'working',
    })),
  };
}

// One Claude Code session's conversation: what you typed and what Claude wrote back (tool calls left out).
async function pageReadCode(id) {
  const r = await fetch(`/v1/code/sessions/${id}/events?limit=300&sort_order=desc`, { credentials: 'include', headers: { 'anthropic-beta': 'ccr-byoc-2025-07-29', 'anthropic-version': '2023-06-01', 'anthropic-client-platform': 'web_claude_ai' } });
  if (!r.ok) throw new Error(String(r.status));
  const newest = (await r.json()).data || [];
  // What Claude is doing right now, like Claude Code's grey line: a command's description, the file it's reading, etc.
  const base = (p) => String(p || '').split(/[\\/]/).pop();
  const describe = (b) => {
    const i = b.input || {};
    const mcp = /^mcp__(.+?)__(.+)$/.exec(b.name || '');
    // "Using Claude Browser"; connectors with id-like names fall back to the tool ("Using notion search").
    if (mcp) return 'Using ' + (/^[0-9a-f-]{20,}$/i.test(mcp[1]) ? mcp[2] : mcp[1]).replace(/^plugin_[^_]+_/, '').replace(/[-_]+/g, ' ');
    switch (b.name) {
      case 'Bash': case 'PowerShell': return i.description || 'Running a command';
      case 'Read': return 'Reading ' + base(i.file_path);
      case 'Edit': case 'Write': case 'NotebookEdit': return 'Editing ' + base(i.file_path || i.notebook_path);
      case 'Grep': case 'Glob': return 'Searching the code';
      case 'WebFetch': case 'WebSearch': return 'Searching the web';
      case 'Agent': case 'Task': return i.description || 'Running an agent';
      case 'TodoWrite': return 'Updating the plan';
      default: return b.name || null;
    }
  };
  let status = null;
  for (const e of newest) {
    const blocks = e.payload?.message?.content;
    if (e.event_type === 'user') { if (Array.isArray(blocks) && blocks.some((b) => b.type === 'tool_result')) continue; break; }
    if (e.event_type !== 'assistant' || !Array.isArray(blocks) || !blocks.length) continue;
    const b = blocks.at(-1);
    status = b.type === 'tool_use' ? describe(b) : b.type === 'thinking' ? 'Thinking' : null;
    break;
  }
  const events = newest.reverse();
  const messages = [];
  for (const e of events) {
    const msg = e.payload && e.payload.message;
    if (!msg || (e.event_type !== 'user' && e.event_type !== 'assistant')) continue;
    const blocks = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content || [];
    // A "user" event that carries tool results is the tool talking, not you.
    if (e.event_type === 'user' && blocks.some((b) => b.type === 'tool_result')) continue;
    const text = blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n\n').trim();
    if (!text || /^<(system-reminder|command-|local-command)/.test(text)) continue;
    const role = e.event_type === 'user' ? 'user' : 'assistant';
    // Claude often writes several short text blocks in one turn; show them as one message.
    const last = messages[messages.length - 1];
    if (last && last.role === role && role === 'assistant') last.text += '\n\n' + text;
    else messages.push({ role, text });
  }
  return { messages, status };
}

// Claude Code environments you can start a session in.
async function pageListEnvironments() {
  const orgs = await (await fetch('/api/organizations', { credentials: 'include' })).json();
  const org = (orgs.find((o) => (o.capabilities || []).includes('chat')) || orgs[0]).uuid;
  const r = await fetch(`/v1/environment_providers/private/organizations/${org}/environments?limit=1000`, { credentials: 'include', headers: { 'anthropic-beta': 'ccr-byoc-2025-07-29', 'anthropic-version': '2023-06-01', 'anthropic-client-platform': 'web_claude_ai' } });
  const j = await r.json();
  return (j.environments || []).filter((e) => e.state === 'active').map((e) => ({ id: e.environment_id, name: e.name, kind: e.kind }));
}

const pageBusy = `!!document.querySelector('[data-is-streaming="true"], button[aria-label*="stop" i], button[aria-label*="interrupt" i]')`;

// Types the text into the composer, presses its send button, and only says ok once the box has emptied
// (claude.ai clears it when it takes the message). Co-work: chat-input / chat-input-send. Code: code-prompt-input / code-prompt-send.
// Match these exactly: the page also has "Send feedback" and a type=submit "Scroll to bottom" button.
async function pageSend(text) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = (el) => (el.tagName === 'TEXTAREA' ? el.value : el.innerText).trim();
  let box;
  for (let i = 0; i < 60 && !box; i++) {
    box = document.querySelector('[data-testid="chat-input"], [data-testid="code-prompt-input"]');
    if (!box) await sleep(250);
  }
  if (!box) return { error: 'Couldn’t find Claude’s message box.' };
  box.focus();
  if (box.tagName === 'TEXTAREA') {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
  }
  await sleep(350);
  if (!read(box)) return { error: 'Couldn’t type into Claude’s message box.' };
  let btn;
  for (let i = 0; i < 24 && !btn; i++) {
    btn = document.querySelector('[data-testid="chat-input-send"], [data-testid="code-prompt-send"]');
    if (!btn || btn.disabled) { btn = null; await sleep(250); }
  }
  if (!btn) return { error: 'Claude’s send button didn’t turn on.' };
  btn.click();
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (!read(box) || !box.isConnected) return { ok: true };
  }
  return { error: 'Claude didn’t take the message. It’s still in the box on the computer.' };
}

// On a new chat or Code session: makes sure the model is the given one (e.g. 'Opus 5.5'), whatever was used last.
async function pageChooseModel(name) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = (el) => { for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, view: window, button: 0 })); };
  const is = () => (trigger.getAttribute('aria-label') || '').startsWith('Model: ' + name);
  let trigger;
  for (let i = 0; i < 40 && !trigger; i++) {
    trigger = document.querySelector('[data-testid="model-selector-dropdown"], [data-testid="environment-row-model"]');
    if (!trigger) await sleep(250);
  }
  if (!trigger) return { error: 'Couldn’t find the model picker.' };
  if (is()) return { ok: true };
  press(trigger);
  await sleep(700);
  const pick = [...document.querySelectorAll('[role="menuitemradio"]')].find((o) => o.innerText.trim().startsWith(name));
  if (!pick) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return { error: `${name} isn’t in Claude’s model list.` }; }
  press(pick);
  await sleep(600);
  return is() ? { ok: true } : { error: `Couldn’t switch to ${name}.` };
}

// On claude.ai/code's new-session screen: picks an environment from the picker under the prompt.
// group is the submenu ('Cloud' or 'Remote Control'); label is the entry's name in it.
async function pageChooseEnv(group, label) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = (el) => { for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, view: window, button: 0 })); };
  const hover = (el) => { const r = el.getBoundingClientRect(); for (const t of ['pointerover', 'pointerenter', 'pointermove', 'mouseover', 'mouseenter', 'mousemove']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, view: window, clientX: r.x + 10, clientY: r.y + 5 })); };
  const items = () => [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
  const firstLine = (el) => el.innerText.split('\n').map((s) => s.trim()).find(Boolean) || '';
  let trigger;
  for (let i = 0; i < 40 && !trigger; i++) {
    trigger = document.querySelector('[data-testid="environment-bar-trigger"]');
    if (!trigger) await sleep(250);
  }
  if (!trigger) return { error: 'Couldn’t find the environment picker.' };
  if ((trigger.getAttribute('aria-label') || '').endsWith(': ' + label)) return { ok: true };
  press(trigger);
  await sleep(600);
  const sub = items().find((o) => firstLine(o) === group);
  if (!sub) return { error: `No “${group}” environments on claude.ai.` };
  hover(sub);
  sub.focus();
  sub.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await sleep(700);
  const pick = items().find((o) => firstLine(o) === label);
  if (!pick) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return { error: `Couldn’t find “${label}” under ${group}.` }; }
  press(pick);
  await sleep(600);
  return { ok: true, now: trigger.getAttribute('aria-label') };
}

/* ---------- hidden Claude windows ---------- */
const views = new Map(); // name → BrowserWindow

function view(name, url) {
  let w = views.get(name);
  if (w && !w.isDestroyed()) {
    if (url && w.webContents.getURL() !== url && !w.webContents.getURL().startsWith(url)) w.loadURL(url);
    return w;
  }
  w = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { partition: 'persist:claude', backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.on('closed', () => views.delete(name));
  views.set(name, w);
  w.loadURL(url || ORIGIN + '/robots.txt');
  return w;
}

function closeView(name) {
  const w = views.get(name);
  if (w && !w.isDestroyed()) w.destroy();
  views.delete(name);
}

const loaded = (w) => new Promise((res) => {
  if (!w.webContents.isLoading()) return res();
  w.webContents.once('did-stop-loading', res);
  setTimeout(res, 20000);
});

async function run(w, fn, ...args) {
  await loaded(w);
  const src = typeof fn === 'string' ? fn : `(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`;
  return w.webContents.executeJavaScript(src, true);
}

/* ---------- thread state ---------- */
// threads: the top few, with messages. history: every recent thread, titles only, for the phone's list.
const S = { threads: [], history: [], org: null, error: null, lastAsk: 0, refreshing: null };
const keyOf = (kind, id) => `${kind}:${id}`;
const urlOf = (kind, id) => `${ORIGIN}/${kind === 'code' ? 'code' : 'chat'}/${id}`;

// One thread with its messages. t is { kind, id, title, t (updated), busy }; old is the last copy, kept if reading fails.
async function readThread(t, old) {
  const key = keyOf(t.kind, t.id);
  let messages = old?.messages || [], title = t.title, busy = false, status = null;
  try {
    if (t.kind === 'cowork') {
      if (!S.org) await refresh();
      const r = await run(view('api'), pageReadChat, S.org, t.id);
      messages = r.messages; title = r.title || title; status = r.status;
      const w = views.get(key);
      busy = w && !w.isDestroyed() ? await run(w, pageBusy).catch(() => false) : messages.at(-1)?.role === 'user';
    } else {
      ({ messages, status } = await run(view('api'), pageReadCode, t.id));
      busy = !!t.busy;
    }
  } catch {}
  return { key, kind: t.kind, id: t.id, title, updated: t.t, busy, status: busy ? status : null, url: urlOf(t.kind, t.id), messages: messages.slice(-KEEP_MESSAGES) };
}

async function refresh() {
  if (S.refreshing) return S.refreshing;
  S.refreshing = (async () => {
    let chats = [], code = [], signedOut = false, failed = null;
    try {
      const r = await run(view('api'), pageListChats, HISTORY);
      if (r.error) signedOut = true; else { S.org = r.org; chats = r.items.map((c) => ({ kind: 'cowork', id: c.id, title: c.title, t: Date.parse(c.updated) || 0 })); }
    } catch (e) {
      if (/\b(401|403)\b/.test(e.message)) signedOut = true; else failed = 'Claude: ' + e.message;
    }
    try {
      const r = await run(view('api'), pageListCode, HISTORY);
      if (r.error) signedOut = true;
      else code = r.items.map((c) => ({ kind: 'code', id: c.id, title: c.title, t: c.when, busy: c.busy }));
    } catch (e) { failed = failed || 'Claude Code: ' + e.message; }
    if (signedOut && !chats.length && !code.length) { S.error = 'signed-out'; S.threads = []; return; }
    if (failed && !chats.length && !code.length) { S.error = failed; return; }

    const all = [...chats, ...code].sort((a, b) => b.t - a.t);
    S.history = all.map((t) => ({ key: keyOf(t.kind, t.id), kind: t.kind, title: t.title, updated: t.t }));
    const prev = new Map(S.threads.map((t) => [t.key, t]));
    const next = await Promise.all(all.slice(0, TOP).map((t) => readThread(t, prev.get(keyOf(t.kind, t.id)))));
    // Hidden windows for threads that left the top four go away.
    for (const name of [...views.keys()]) if (/^(cowork|code):/.test(name) && !next.some((t) => t.key === name)) closeView(name);
    S.threads = next;
    S.error = failed;
  })().finally(() => { S.refreshing = null; });
  return S.refreshing;
}

// Fast while the phone is looking, slow otherwise.
let timer;
function schedule() {
  clearTimeout(timer);
  const active = Date.now() - S.lastAsk < 90e3;
  timer = setTimeout(() => refresh().catch(() => {}).finally(schedule), active ? 4000 : 60000);
}

async function reply(key, text) {
  const [kind, id] = key.split(':');
  if (!['cowork', 'code'].includes(kind) || !id) throw new Error('Unknown thread');
  const w = view(key, urlOf(kind, id));
  const r = await run(w, pageSend, text);
  if (r.error) throw new Error(r.error);
  setTimeout(() => refresh().catch(() => {}), 1500);
  return r;
}

async function startThread(kind, text, env) {
  const name = 'new-' + Date.now();
  const w = view(name, kind === 'code' ? ORIGIN + '/code' : ORIGIN + '/new');
  try {
    if (kind === 'code' && env) {
      const e = (await environments()).envs.find((x) => x.id === env);
      if (!e) throw new Error('That environment is gone. Pick another.');
      const c = await run(w, pageChooseEnv, e.group, e.label);
      if (c.error) throw new Error(c.error);
    }
    const mdl = await run(w, pageChooseModel, NEW_MODEL);
    if (mdl.error) throw new Error(mdl.error);
    const r = await run(w, pageSend, text);
    if (r.error) throw new Error(r.error);
    // Wait for claude.ai to move to the new thread's address.
    const re = kind === 'code' ? /\/code\/(session_[^/?#]+)/ : /\/chat\/([^/?#]+)/;
    let id;
    for (let i = 0; i < 60 && !id; i++) {
      const m = re.exec(w.webContents.getURL());
      if (m && m[1] !== 'new') id = m[1];
      else await new Promise((res) => setTimeout(res, 500));
    }
    if (!id) throw new Error('Sent, but the new thread didn’t open. Check Claude on the computer.');
    const key = keyOf(kind, id);
    // Keep this window as the thread's own, so it can keep streaming.
    views.delete(name);
    closeView(key);
    views.set(key, w);
    w.removeAllListeners('closed');
    w.on('closed', () => views.delete(key));
    setTimeout(() => refresh().catch(() => {}), 1500);
    return { key };
  } catch (e) {
    closeView(name);
    throw e;
  }
}

// Each environment with the submenu and label claude.ai's picker shows it under:
// cloud ones by name, Remote Control ones by their folder ("MyPC:C:\Users\me\project:ff38" → "project").
let envCache = { at: 0, envs: [] };
async function environments() {
  if (Date.now() - envCache.at < 5 * 6e4 && envCache.envs.length) return envCache;
  const list = await run(view('api'), pageListEnvironments);
  const envs = list.map((e) => {
    const bridged = e.kind === 'bridge';
    const folder = bridged ? (e.name.split(':').slice(1, -1).join(':') || e.name) : '';
    const machine = bridged ? e.name.split(':')[0] : '';
    return { id: e.id, group: bridged ? 'Remote Control' : 'Cloud', label: bridged ? folder.split(/[\\/]/).filter(Boolean).pop() || e.name : e.name, where: bridged ? `${machine} · ${folder}` : 'Anthropic cloud' };
  });
  envCache = { at: Date.now(), envs };
  return envCache;
}

/* ---------- HTTP ---------- */
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((res, rej) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 64e3) { rej(new Error('Too long')); req.destroy(); } });
    req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch { rej(new Error('Bad JSON')); } });
  });
}

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const dir = updater.dispatchDir();
  const file = path.normalize(path.join(dir, p));
  if (!file.startsWith(dir + path.sep)) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(file, (err, buf) => (err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream')));
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
  // Writes need a custom header, which a web page elsewhere can't add without a CORS preflight (never answered).
  if (req.method !== 'GET' && req.headers['x-monodesk'] !== '1') return send(res, 403, { error: 'Forbidden' });
  S.lastAsk = Date.now();
  try {
    if (req.method === 'GET' && url.pathname === '/api/threads') {
      if (!S.threads.length || url.searchParams.has('now')) await refresh();
      schedule();
      return send(res, 200, { threads: S.threads, error: S.error, at: Date.now() });
    }
    if (req.method === 'GET' && url.pathname === '/api/environments') return send(res, 200, await environments());
    if (req.method === 'GET' && url.pathname === '/api/history') {
      if (!S.history.length || url.searchParams.has('now')) await refresh();
      return send(res, 200, { threads: S.history });
    }
    const one = /^\/api\/threads\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && one) {
      const key = decodeURIComponent(one[1]);
      const [kind, id] = key.split(':');
      if (!['cowork', 'code'].includes(kind) || !id) return send(res, 404, { error: 'Unknown thread' });
      const h = S.history.find((x) => x.key === key);
      return send(res, 200, await readThread({ kind, id, title: h?.title || '', t: h?.updated || 0 }, S.threads.find((x) => x.key === key)));
    }
    const m = /^\/api\/threads\/([^/]+)\/reply$/.exec(url.pathname);
    if (req.method === 'POST' && m) {
      const { text } = await readBody(req);
      if (!String(text || '').trim()) return send(res, 400, { error: 'Nothing to send' });
      return send(res, 200, await reply(decodeURIComponent(m[1]), String(text)));
    }
    if (req.method === 'POST' && url.pathname === '/api/new') {
      const { kind, text, env } = await readBody(req);
      if (!['cowork', 'code'].includes(kind) || !String(text || '').trim()) return send(res, 400, { error: 'Pick Co-work or Code and say something' });
      return send(res, 200, await startThread(kind, String(text), env ? String(env) : ''));
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 500, { error: e.message || 'Something went wrong' });
  }
}

let server;
function start() {
  if (server) return;
  server = http.createServer((req, res) => { handle(req, res); });
  server.on('error', (e) => console.error('Monodesk Phone bridge:', e.message));
  server.listen(PORT, HOST);
  schedule();
  updater.ensureDispatch().catch((e) => console.error('Monodesk: could not download Dispatch:', e.message));
}

module.exports = { start, PORT };
