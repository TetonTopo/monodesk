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

/* ---------- ElevenLabs read-aloud ---------- */
// Dispatch's speaker asks for MP3s here. The API key lives only in this PC's config.js (elevenLabsKey), never in a
// repo, and never goes to the phone. With no key, /api/voices says so and Dispatch uses the phone's own voice.
const XI = 'https://api.elevenlabs.io';
// Credits per character on ElevenLabs' self-serve plans. limit: the most one request takes; longer text goes in parts.
const MODELS = {
  eleven_flash_v2_5: { name: 'Fast', about: 'Flash v2.5', per: 0.5, limit: 4500 },
  eleven_multilingual_v2: { name: 'Best', about: 'Multilingual v2', per: 1, limit: 4500 },
  eleven_v3: { name: 'Expressive', about: 'Eleven v3', per: 1, limit: 2800 },
};
const DEFAULT_MODEL = 'eleven_flash_v2_5';
const MATILDA = 'XrExE9yKIg1WjnnlVkGX'; // ElevenLabs' own Matilda, the last resort when no Australian voice is found
// ElevenLabs' built-in voices, for a key that may only make speech (no Voices permission, so it can't list any).
const BUILT_IN = [
  ['IKne3meq5aSn9XLyUdCD', 'Charlie', 'australian', 'male', 'conversational'],
  ['XrExE9yKIg1WjnnlVkGX', 'Matilda', 'american', 'female', 'warm'],
  ['Xb7hH8MSUJpSbSDYk0k2', 'Alice', 'british', 'female', 'clear'],
  ['pFZP5JQG7iQjIQuC4Bku', 'Lily', 'british', 'female', 'warm'],
  ['EXAVITQu4vr4xnSDxMaL', 'Sarah', 'american', 'female', 'soft'],
  ['21m00Tcm4TlvDq8ikWAM', 'Rachel', 'american', 'female', 'calm'],
  ['JBFqnCBsd6RMkjVDRZzb', 'George', 'british', 'male', 'warm'],
].map(([id, name, accent, gender, about]) => ({ id, name, accent, gender, about, preview: '', mine: true }));

// config.js is browser code (window.MONODESK_CONFIG = …), so it's run in an empty sandbox. Re-read when it changes.
let cfg = { at: 0, val: {} };
function config() {
  const file = path.join(__dirname, 'config.js');
  try {
    const at = fs.statSync(file).mtimeMs;
    if (at !== cfg.at) {
      const box = { window: {} };
      require('vm').runInNewContext(fs.readFileSync(file, 'utf8'), box, { timeout: 500 });
      cfg = { at, val: box.window.MONODESK_CONFIG || {} };
    }
  } catch { cfg = { at: 0, val: {} }; }
  return cfg.val;
}
const xiKey = () => String(config().elevenLabsKey || process.env.ELEVENLABS_API_KEY || '').trim();

async function xi(p, opts = {}) {
  const r = await fetch(XI + p, {
    ...opts,
    headers: { 'xi-api-key': xiKey(), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(60000),
  });
  if (r.ok) return r;
  let detail = '', message = '';
  try { const j = await r.json(); detail = j.detail?.status || j.detail?.message || (typeof j.detail === 'string' ? j.detail : ''); message = j.detail?.message || ''; } catch {}
  // A key can have its own credit limit, separate from the account's ("…exceeds your API key (name) quota of 1000…").
  const keyCap = /API key .*quota of (\d+)/i.exec(message);
  const why = keyCap ? `the API key's own credit limit (${(+keyCap[1]).toLocaleString('en-US')}) is used up. Raise it at elevenlabs.io → Developers → API Keys`
    : /missing_permissions/.test(detail) ? 'the key in config.js needs more access on elevenlabs.io'
    : /quota|credit/i.test(detail) ? 'out of credits'
    : r.status === 401 ? 'it didn’t accept the key in config.js'
    : r.status === 429 ? 'too busy right now'
    : detail || 'error ' + r.status;
  const e = new Error('ElevenLabs: ' + why);
  e.status = r.status;
  throw e;
}

// Your voices, plus Australian ones from the shared library, plus your credit balance. Kept for 10 minutes.
let xiCache = { at: 0, key: '', val: null };
async function xiVoices(fresh) {
  const key = xiKey();
  if (!key) return { enabled: false };
  if (!fresh && xiCache.val && xiCache.key === key && Date.now() - xiCache.at < 10 * 6e4) return xiCache.val;
  // An ElevenLabs collection named like config.js's elevenLabsCollection (default "dispatch") is the whole list when
  // it exists; otherwise all your voices, plus Australian ones from the shared library.
  const want = String(config().elevenLabsCollection ?? 'dispatch').trim().toLowerCase();
  const coll = want ? await xi('/v1/voices/collections').then((r) => r.json())
    .then((j) => (j.collections || []).find((c) => String(c.title || '').trim().toLowerCase() === want), () => null) : null;
  const [mine, aus, sub] = await Promise.allSettled([
    xi('/v2/voices?page_size=100' + (coll ? '&collection_id=' + encodeURIComponent(coll.collection_id) : '')).then((r) => r.json()),
    coll ? Promise.resolve({ voices: [] }) : xi('/v1/shared-voices?language=en&accent=australian&page_size=40&sort=trending').then((r) => r.json()),
    xi('/v1/user/subscription').then((r) => r.json()),
  ]);
  // A key without the Voices permission can still make speech, in ElevenLabs' built-in voices.
  const limited = mine.status === 'rejected' && /needs more access/.test(mine.reason.message);
  if (mine.status === 'rejected' && !limited) throw mine.reason;
  const voices = limited ? BUILT_IN : (mine.value.voices || []).map((v) => ({
    id: v.voice_id, name: v.name, accent: v.labels?.accent || '', gender: v.labels?.gender || '',
    about: v.labels?.descriptive || v.labels?.description || v.labels?.use_case || '', preview: v.preview_url || '', mine: true,
  }));
  const have = new Set(voices.flatMap((v) => [v.id, v.name]));
  // Library voices whose owners charge more than the normal rate are left out.
  const library = aus.status === 'fulfilled' ? (aus.value.voices || []).filter((v) => !have.has(v.voice_id) && !have.has(v.name) && !(v.rate > 1) && !v.fiat_rate).map((v) => ({
    id: v.voice_id, owner: v.public_owner_id, name: v.name, accent: v.accent || 'australian', gender: v.gender || '',
    about: v.descriptive || v.use_case || '', preview: v.preview_url || '', mine: false,
  })) : [];
  const aussie = (v) => /austral/i.test(v.accent);
  const female = (v) => /female|woman/i.test(v.gender);
  // Default: config.js's elevenLabsVoice, else an Australian woman you already have, else one from the library
  // (added to your voices the first time it reads), else ElevenLabs' Matilda.
  const named = String(config().elevenLabsVoice || '');
  const def = voices.find((v) => v.id === named) || voices.find((v) => aussie(v) && female(v)) || library.find(female)
    || voices.find(aussie) || library[0] || voices.find((v) => v.id === MATILDA) || voices[0] || { id: MATILDA, mine: true };
  const s = sub.status === 'fulfilled' ? sub.value : null;
  const val = {
    enabled: true,
    limited, // true: the key can't list voices or read credits, so Dispatch says how to give it more access
    collection: coll ? coll.title : null,
    voices, library,
    default: { id: def.id, owner: def.mine === false ? def.owner : undefined, name: def.name || 'Matilda' },
    models: Object.entries(MODELS).map(([id, m]) => ({ id, name: m.name, about: m.about, per: m.per })),
    model: MODELS[config().elevenLabsModel] ? config().elevenLabsModel : DEFAULT_MODEL,
    credits: s ? { used: s.character_count, limit: s.character_limit, reset: (s.next_character_count_reset_unix || 0) * 1000 } : null,
  };
  xiCache = { at: Date.now(), key, val };
  return val;
}

// Long text in parts of at most n characters, split between lines, then sentences.
function parts(text, n) {
  const out = [];
  let cur = '';
  for (const piece of text.split(/(?<=\n)|(?<=[.!?])\s+/)) {
    if (cur && (cur + ' ' + piece).length > n) { out.push(cur.trim()); cur = ''; }
    cur += (cur && !cur.endsWith('\n') ? ' ' : '') + piece;
    while (cur.length > n) { out.push(cur.slice(0, n)); cur = cur.slice(n); }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// The same reply in the same voice and model is only paid for once (until Monodesk restarts).
const audioCache = new Map();
async function xiSpeak({ text, voice, owner, model, pause }) {
  if (!xiKey()) throw Object.assign(new Error('No ElevenLabs key in config.js'), { status: 409 });
  text = String(text || '').replace(/\r/g, '').trim();
  if (!text) throw Object.assign(new Error('Nothing to read'), { status: 400 });
  const info = await xiVoices();
  model = MODELS[model] ? model : info.model;
  const m = MODELS[model];
  if (!voice) ({ id: voice, owner } = info.default);
  voice = String(voice);
  // A library voice is added to your voices once, the first time you use it.
  if (owner && !info.voices.some((v) => v.id === voice)) {
    const v = info.library.find((x) => x.id === voice);
    const r = await xi(`/v1/voices/add/${encodeURIComponent(owner)}/${encodeURIComponent(voice)}`, { method: 'POST', body: JSON.stringify({ new_name: v?.name || 'Dispatch voice' }) });
    voice = (await r.json()).voice_id || voice;
    xiCache.at = 0;
  }
  // The sentence pause becomes a short break between lines (v3 has no breaks).
  const ms = Math.min(+pause || 0, 3000);
  const said = ms > 0 && model !== 'eleven_v3' ? text.split('\n').join(` <break time="${(ms / 1000).toFixed(2)}s" />\n`) : text;
  const key = require('crypto').createHash('sha1').update([model, voice, said].join('\0')).digest('hex');
  if (audioCache.has(key)) return { audio: audioCache.get(key), credits: 0, cached: true, voice };
  const chunks = parts(said, m.limit);
  const bufs = [];
  let credits = 0;
  for (let i = 0; i < chunks.length; i++) {
    const body = { text: chunks[i], model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } };
    if (model !== 'eleven_v3') { if (i) body.previous_text = chunks[i - 1].slice(-400); if (i < chunks.length - 1) body.next_text = chunks[i + 1].slice(0, 400); }
    const r = await xi(`/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, { method: 'POST', body: JSON.stringify(body) });
    const cost = r.headers.get('character-cost');
    credits += cost != null && Number.isFinite(+cost) ? +cost : Math.ceil(chunks[i].length * m.per);
    bufs.push(Buffer.from(await r.arrayBuffer()));
  }
  const audio = Buffer.concat(bufs);
  audioCache.set(key, audio);
  while (audioCache.size > 40) audioCache.delete(audioCache.keys().next().value);
  if (xiCache.val?.credits) xiCache.val.credits.used += credits;
  return { audio, credits, cached: false, voice };
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
    if (req.method === 'GET' && url.pathname === '/api/voices') return send(res, 200, await xiVoices(url.searchParams.has('now')));
    if (req.method === 'POST' && url.pathname === '/api/speak') {
      const r = await xiSpeak(await readBody(req));
      const left = xiCache.val?.credits ? xiCache.val.credits.limit - xiCache.val.credits.used : '';
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': r.audio.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Credits': r.credits, 'X-Credits-Left': left, 'X-Cached': r.cached ? '1' : '0', 'X-Voice': r.voice });
      return res.end(r.audio);
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, e.status >= 400 && e.status < 500 ? (e.status === 401 ? 502 : e.status) : 500, { error: e.message || 'Something went wrong' });
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
