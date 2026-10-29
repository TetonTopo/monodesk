// What each app is using, for the 𝕸 menu: network (down and up, live and since Monodesk started), CPU and memory.
// Network is counted inside Monodesk through each view's own DevTools connection (webContents.debugger), including
// WebSocket frames (WhatsApp's live connection) and the iframes and workers inside a page. It covers the apps' own
// traffic, so it won't match Task Manager exactly, but it shows which app is the heavy one.
// CPU and memory come from app.getAppMetrics(), matched to each view by its process.
const { app, BrowserWindow, session, webContents } = require('electron');

const ROWS = ['mail', 'notion', 'cowork', 'code', 'wa', 'cal', 'bridge', 'monodesk'];
const PARTS = { mail: 'persist:mail', notion: 'persist:notion', claude: 'persist:claude', wa: 'persist:wa' };
const DISPATCH = /^https?:\/\/127\.0\.0\.1:47800\//;

let shell = null; // Monodesk's own window
const watched = new Map(); // webContents id → { c, row, down, up, sess: Map(sessionId → row), reqs: Map }
const gone = {}; // totals from views that have closed, by row
const last = { t: 0, totals: {} };

const partOf = (c) => Object.keys(PARTS).find((k) => c.session === session.fromPartition(PARTS[k]));

// Which row a view counts under. A sleeping view (about:blank) keeps the row it had.
function rowOf(c, prev) {
  if (c === shell) return 'monodesk';
  const url = c.getURL();
  if (!/^https?:/.test(url) && prev) return prev;
  const part = partOf(c);
  if (c.getType() === 'window') {
    const w = BrowserWindow.fromWebContents(c);
    // Hidden windows read Claude for Dispatch (the bridge) or Google Calendar for Home's meetings.
    if (!w || !w.isVisible()) return part === 'claude' ? 'bridge' : 'monodesk';
  }
  if (part === 'claude') return /^https:\/\/claude\.ai\/code\b/.test(url) ? 'code' : /^https:\/\/claude\.ai\/duet\b/.test(url) ? 'duet' : 'cowork';
  if (part === 'mail') return /^https:\/\/calendar\.google\.com\//.test(url) ? 'cal' : 'mail';
  return part || 'monodesk';
}

// A WebSocket frame's size: text frames as text, binary frames arrive base64-encoded.
const frameLen = (r) => (!r?.payloadData ? 0 : r.opcode === 1 ? Buffer.byteLength(r.payloadData) : Math.floor(r.payloadData.length * 3 / 4));
// What a request sends: roughly its first line and headers, plus its body when DevTools passes it along.
const reqLen = (q) => (q.url?.length || 0) + JSON.stringify(q.headers || {}).length + (q.postData ? Buffer.byteLength(q.postData) : 0);

function watch(c) {
  if (watched.has(c.id) || c.isDestroyed()) return;
  const d = c.debugger;
  try { if (!d.isAttached()) d.attach('1.3'); } catch { return; }
  const w = { c, row: rowOf(c), down: 0, up: 0, sess: new Map(), reqs: new Map() };
  watched.set(c.id, w);
  const enable = (sid) => {
    const send = (m, p) => d.sendCommand(m, p, sid).catch(() => {});
    // Small buffers: Monodesk only counts bytes, it never reads response bodies.
    send('Network.enable', { maxTotalBufferSize: 1e6, maxResourceBufferSize: 1e5, maxPostDataSize: 65536 });
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  };
  const add = (sid, field, n) => {
    if (!n) return;
    const r = (sid && w.sess.get(sid)) || null;
    if (r) { gone[r] = gone[r] || { down: 0, up: 0 }; gone[r][field] += n; } // Dispatch inside Monodesk's window counts as the bridge
    else w[field] += n;
  };
  d.on('message', (_e, method, p, sid) => {
    switch (method) {
      case 'Network.requestWillBeSent': add(sid, 'up', reqLen(p.request || {})); break;
      case 'Network.dataReceived': {
        const k = (sid || '') + p.requestId, n = p.encodedDataLength || 0;
        w.reqs.set(k, (w.reqs.get(k) || 0) + n);
        add(sid, 'down', n);
        break;
      }
      case 'Network.loadingFinished': {
        // The finished total includes headers and any bytes not reported chunk by chunk.
        const k = (sid || '') + p.requestId, got = w.reqs.get(k) || 0;
        if (p.encodedDataLength > got) add(sid, 'down', p.encodedDataLength - got);
        w.reqs.delete(k);
        break;
      }
      case 'Network.loadingFailed': w.reqs.delete((sid || '') + p.requestId); break;
      case 'Network.webSocketFrameReceived': add(sid, 'down', frameLen(p.response)); break;
      case 'Network.webSocketFrameSent': add(sid, 'up', frameLen(p.response)); break;
      case 'Target.attachedToTarget':
        if (DISPATCH.test(p.targetInfo?.url || '')) w.sess.set(p.sessionId, 'bridge');
        enable(p.sessionId);
        break;
    }
    if (w.reqs.size > 5000) w.reqs.clear();
  });
  d.on('detach', () => { retire(w); });
  c.once('destroyed', () => retire(w));
  enable();
}

function retire(w) {
  if (!watched.has(w.c.id)) return;
  watched.delete(w.c.id);
  const g = (gone[w.row] = gone[w.row] || { down: 0, up: 0 });
  g.down += w.down;
  g.up += w.up;
}

function start(win) {
  shell = win.webContents;
  for (const c of webContents.getAllWebContents()) if (['window', 'webview'].includes(c.getType())) watch(c);
}

// Every app's numbers right now. Rates are since the last call (the menu asks every two seconds).
// apps: { webContents id: row } from the window, which knows each app view's app even when its page is a sign-in page.
function snapshot(apps = {}) {
  const now = Date.now();
  const told = (c, prev) => (ROWS.includes(apps[c.id]) ? apps[c.id] : rowOf(c, prev));
  const rows = Object.fromEntries(ROWS.map((r) => [r, { row: r, down: gone[r]?.down || 0, up: gone[r]?.up || 0, cpu: 0, mem: 0, views: 0 }]));
  for (const w of watched.values()) {
    if (w.c.isDestroyed()) continue;
    const r = (w.row = told(w.c, w.row)); // a Claude tab that moves between Co-work and Claude Code takes its total with it
    rows[r].down += w.down;
    rows[r].up += w.up;
  }
  // Processes: each view's own, plus the processes of the frames inside it. A process two apps share is split between them.
  const owners = new Map(); // pid → Set(row)
  const own = (pid, r) => { if (pid > 0) (owners.get(pid) || owners.set(pid, new Set()).get(pid)).add(r); };
  for (const c of webContents.getAllWebContents()) {
    if (c.isDestroyed() || !['window', 'webview'].includes(c.getType())) continue;
    const r = told(c, watched.get(c.id)?.row);
    if (/^https?:/.test(c.getURL()) || c === shell) { rows[r].views++; own(c.getOSProcessId(), r); }
    try {
      // The shell's frames include every app view inside it, so from the shell only Dispatch's frame counts.
      for (const f of c.mainFrame.framesInSubtree) {
        if (f === c.mainFrame) continue;
        if (DISPATCH.test(f.url)) own(f.osProcessId, 'bridge');
        else if (c !== shell) own(f.osProcessId, r);
      }
    } catch {}
  }
  for (const m of app.getAppMetrics()) {
    const set = owners.get(m.pid);
    const list = set ? [...set] : ['monodesk']; // the browser, GPU and network processes are Monodesk's own
    for (const r of list) {
      rows[r].cpu += (m.cpu?.percentCPUUsage || 0) / list.length;
      rows[r].mem += ((m.memory?.privateBytes || m.memory?.workingSetSize || 0) * 1024) / list.length;
    }
  }
  // Rates and CPU only mean "right now" if the last reading was recent; the menu's first reading shows a dash.
  const dt = last.t ? (now - last.t) / 1000 : 0;
  const fresh = dt > 0.3 && dt < 6;
  for (const r of ROWS) {
    const prev = last.totals[r];
    rows[r].downRate = fresh && prev ? Math.max(0, rows[r].down - prev.down) / dt : null;
    rows[r].upRate = fresh && prev ? Math.max(0, rows[r].up - prev.up) / dt : null;
    if (!fresh) rows[r].cpu = null;
  }
  last.t = now;
  last.totals = Object.fromEntries(ROWS.map((r) => [r, { down: rows[r].down, up: rows[r].up }]));
  return ROWS.map((r) => rows[r]);
}

module.exports = { start, watch, snapshot };
