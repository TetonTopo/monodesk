const { app, BrowserWindow, Menu, Tray, ipcMain, clipboard, shell, nativeTheme, session } = require('electron');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const bridge = require('./bridge');
const updater = require('./updater');
const calendar = require('./calendar');

// Present as plain Chrome. WhatsApp Web and Google sign-in refuse browsers that announce "Electron".
app.userAgentFallback = app.userAgentFallback.replace(/\s(monodesk|Electron)\/\S+/gi, '');

const APPS = ['mail', 'notion', 'claude', 'wa'];
const ALLOWED_PERMISSIONS = ['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'];
// Links to an app's own site open as a new tab of that app.
const OWN_HOSTS = { mail: /^mail\.google\.com$/, notion: /(^|\.)notion\.(so|com)$/, claude: /(^|\.)claude\.ai$/ };
// Sign-in pages open as small popups that share the app's session. Every other link goes to your normal browser.
const POPUP_HOSTS = [/(^|\.)accounts\.google\.com$/, /(^|\.)notion\.(so|com)$/, /(^|\.)claude\.ai$/, /(^|\.)anthropic\.com$/, /(^|\.)appleid\.apple\.com$/, /(^|\.)login\.microsoftonline\.com$/];
const SHORTCUT_KEYS = ['k', '\\', 't', 'w', '1', '2', '3', '4', '5', '6', '7'];
// The shell stays dark in both modes.
const OVERLAY = { color: '#121212', symbolColor: '#9c9a95', height: 40 };
const ICON = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// Windows: Monodesk gets its own taskbar identity, so pinning it pins Monodesk rather than bare Electron.
const APP_ID = 'com.monodesk.app';
const LAUNCH_ARGS = `"${__dirname}"`;
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// One Monodesk at a time: starting it again (the shortcut, Start Monodesk.cmd) brings back the one that's running.
// Two copies sharing the same sign-ins would sign each other out.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => showWin());

// Closing the window hides Monodesk to the tray, so the apps stay signed in and Dispatch keeps working.
// Quit from the tray icon's menu. "Start with Windows" starts it in the tray at sign-in.
const LOGIN = { path: process.execPath, args: [__dirname, '--background'] };
let win, tray, quitting = false, hinted = false;
app.on('before-quit', () => { quitting = true; });

function showWin() {
  if (!app.isReady()) return;
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function makeTray() {
  tray = new Tray(ICON);
  tray.setToolTip('Monodesk');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Monodesk', click: showWin },
    { label: process.platform === 'darwin' ? 'Open at login' : 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings(LOGIN).openAtLogin, click: (item) => app.setLoginItemSettings({ ...LOGIN, openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: 'Quit Monodesk', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWin);
}

// Before a restart (an update, a saved change): write every app's cookies and site data to disk first.
// Quitting at once otherwise drops a fresh sign-in, and Notion or WhatsApp asks again.
async function saveSessions() {
  const all = [session.defaultSession, ...APPS.map((m) => session.fromPartition('persist:' + m))];
  await Promise.all(all.map(async (s) => { try { s.flushStorageData(); await s.cookies.flushStore(); } catch {} }));
}
updater.beforeExit(saveSessions);

function createWindow() {
  win = new BrowserWindow({
    show: !(process.argv.includes('--background') && !tray),
    width: 1440,
    height: 920,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#080808',
    title: 'Monodesk',
    icon: ICON,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : OVERLAY,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.platform === 'win32') {
    // What a taskbar pin of this window runs.
    win.setAppDetails({ appId: APP_ID, appIconPath: ICON, relaunchCommand: `"${process.execPath}" ${LAUNCH_ARGS}`, relaunchDisplayName: 'Monodesk' });
  }
  win.loadFile('index.html');
  win.on('close', (e) => {
    if (quitting || !tray) return;
    e.preventDefault();
    win.hide();
    if (!hinted && process.platform === 'win32') {
      hinted = true;
      tray.displayBalloon({ iconType: 'info', title: 'Monodesk is still running', content: 'It stays in the tray to keep you signed in. Right-click its icon to quit.' });
    }
  });
}

// Keeps a Monodesk shortcut in the Start menu and in this folder. Either one starts Monodesk with no console window and can be pinned.
function writeShortcuts() {
  if (process.platform !== 'win32' || app.isPackaged) return;
  const link = { target: process.execPath, args: LAUNCH_ARGS, cwd: __dirname, icon: ICON, iconIndex: 0, appUserModelId: APP_ID, description: 'Gmail, Notion, Claude and WhatsApp in one quiet window.' };
  for (const dir of [path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), __dirname]) {
    try { shell.writeShortcutLink(path.join(dir, 'Monodesk.lnk'), 'create', link); } catch {}
  }
}

function appOf(contents) {
  return APPS.find((m) => contents.session === session.fromPartition('persist:' + m));
}

// A link to another app's page (a Notion page clicked in Claude, say) opens in that app's tab.
// Sign-in and connect flows stay popups, since the page that opened them is waiting for the answer.
const AUTH_PATH = /oauth|authori[sz]e|install-integration|login|signin|signup|sso|callback|consent/i;
function linkApp(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (AUTH_PATH.test(u.pathname + u.search)) return null;
  return Object.keys(OWN_HOSTS).find((m) => OWN_HOSTS[m].test(u.hostname)) || null;
}

// Right-click: Cut / Copy / Paste, links, images and spelling, which Electron leaves out. Apps with their own
// right-click menu (WhatsApp's chat list, Gmail's inbox) keep theirs, since then this event never fires.
function contextMenu(contents) {
  contents.on('context-menu', async (_event, p) => {
    const items = [];
    const sep = () => { if (items.length && items.at(-1).type !== 'separator') items.push({ type: 'separator' }); };
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => contents.replaceMisspelling(s) });
      items.push({ label: 'Add to dictionary', click: () => contents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      sep();
    }
    if (/^https?:|^mailto:/i.test(p.linkURL)) {
      items.push({ label: 'Open link in browser', click: () => shell.openExternal(p.linkURL) }, { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) });
      sep();
    }
    if (p.mediaType === 'image' && p.hasImageContents) {
      items.push({ label: 'Copy image', click: () => contents.copyImageAt(p.x, p.y) });
      if (/^https?:/i.test(p.srcURL)) items.push({ label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) });
      sep();
    }
    const f = p.editFlags;
    if (p.isEditable) {
      items.push(
        { label: 'Undo', enabled: f.canUndo, click: () => contents.undo() },
        { label: 'Redo', enabled: f.canRedo, click: () => contents.redo() },
        { type: 'separator' },
        { label: 'Cut', enabled: f.canCut, click: () => contents.cut() },
        { label: 'Copy', enabled: f.canCopy, click: () => contents.copy() },
        { label: 'Paste', enabled: f.canPaste, click: () => contents.paste() },
        { label: 'Paste as plain text', enabled: f.canPaste, click: () => contents.pasteAndMatchStyle() },
        { type: 'separator' },
        { label: 'Select all', enabled: f.canSelectAll, click: () => contents.selectAll() },
      );
    } else if (p.selectionText.trim()) {
      items.push({ label: 'Copy', click: () => contents.copy() });
    } else if (contents === win?.webContents) {
      // Home's rows are buttons, whose text can't be selected, so they offer their text instead.
      const text = await contents.executeJavaScript(`window.rowText ? window.rowText(${p.x}, ${p.y}) : ''`).catch(() => '');
      if (text) items.push({ label: 'Copy text', click: () => clipboard.writeText(text) });
    }
    while (items.at(-1)?.type === 'separator') items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(contents) || win });
  });
}

// A sign-in window is done once it reaches the app itself (Gmail's inbox, a Notion page), or once it sits empty
// on a callback page that should have closed itself. Then it closes and the app's tab reloads, signed in.
function watchSignIn(child, mod) {
  const own = mod === 'mail' ? /^(mail|calendar)\.google\.com$/ : OWN_HOSTS[mod];
  if (!own) return;
  child.webContents.on('did-finish-load', async () => {
    const url = child.webContents.getURL();
    let u;
    try { u = new URL(url); } catch { return; }
    if (!own.test(u.hostname)) return;
    // First give the page time to hand the sign-in to the tab and close itself, as it's meant to.
    await new Promise((r) => setTimeout(r, 3000));
    if (child.isDestroyed() || child.webContents.getURL() !== url) return;
    const auth = AUTH_PATH.test(u.pathname + u.search);
    if (auth) {
      const empty = await child.webContents.executeJavaScript('!document.body || document.body.innerText.trim().length < 3').catch(() => false);
      if (!empty || child.isDestroyed()) return;
    }
    child.close();
    win?.webContents.send('signed-in', { mod, url: auth ? null : url });
  });
}

app.on('web-contents-created', (_event, contents) => {
  contextMenu(contents);
  // A page's "leave this page?" check never stops Monodesk from quitting or restarting.
  contents.on('will-prevent-unload', (e) => e.preventDefault());
  if (contents.getType() !== 'webview') return;

  contents.on('did-create-window', (child) => watchSignIn(child, appOf(contents)));

  contents.setWindowOpenHandler(({ url }) => {
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    const mod = appOf(contents);
    // Signing in from Google's signed-out pages (the Gmail and Calendar product pages) happens right in the tab.
    let from = '';
    try { from = new URL(contents.getURL()).hostname; } catch {}
    if (mod === 'mail' && /(^|\.)accounts\.google\.com$/.test(host) && !/^(mail|calendar)\.google\.com$/.test(from)) {
      setTimeout(() => contents.loadURL(url).catch(() => {}), 0); // a navigation started inside this handler is dropped
      return { action: 'deny' };
    }
    if (mod && OWN_HOSTS[mod]?.test(host)) {
      win?.webContents.send('new-tab', { mod, url });
      return { action: 'deny' };
    }
    const other = linkApp(url);
    if (other) {
      win?.webContents.send('new-tab', { mod: other, url });
      return { action: 'deny' };
    }
    if (POPUP_HOSTS.some((re) => re.test(host))) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, backgroundColor: '#ffffff' } };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Same for a plain link that would take one app's view over to another app's site.
  contents.on('will-navigate', (event, url) => {
    const mod = appOf(contents), other = linkApp(url);
    if (mod && other && other !== mod) {
      event.preventDefault();
      win?.webContents.send('new-tab', { mod: other, url });
    }
  });

  // Keystrokes inside an app never reach the shell, so forward Monodesk's shortcuts from here.
  contents.on('before-input-event', (event, input) => {
    // Claude: hold Alt to number recent chats, Alt 1–9 to open one, Alt 0 for a new one. AltGr (Ctrl+Alt) is left alone for typing.
    if (appOf(contents) === 'claude' && !input.control && !input.meta) {
      const tag = '@' + contents.id;
      if (input.key === 'Alt') {
        win?.webContents.send('shortcut', (input.type === 'keyDown' ? (input.isAutoRepeat ? '' : 'alt-hold') : 'alt-up') + tag);
        return;
      }
      if (input.type === 'keyDown' && input.alt && !input.shift && /^[0-9]$/.test(input.key)) {
        event.preventDefault();
        win?.webContents.send('shortcut', 'alt+' + input.key + tag);
        return;
      }
    }
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
    const key = input.key.toLowerCase();
    if (input.shift && key === 'e') {
      event.preventDefault();
      win?.webContents.send('shortcut', 'shift+e');
    } else if (!input.shift && !input.alt && SHORTCUT_KEYS.includes(key)) {
      event.preventDefault();
      win?.webContents.send('shortcut', key);
    }
  });
});

// The 𝕸 menu: this version, the newest on GitHub, and updating to it.
ipcMain.handle('version', async () => {
  try { return await updater.check(); } catch (e) { return { current: updater.version(), error: e.message }; }
});
ipcMain.handle('update', async () => {
  try { return await updater.update(); } catch (e) { return { error: e.message }; }
});

// Today's meetings, from Google Calendar with the Mail tab's sign-in.
ipcMain.handle('calendar', (_e, force) => calendar.events(!!force));

ipcMain.handle('copy', (_e, text) => {
  clipboard.writeText(String(text ?? ''));
  return true;
});

ipcMain.handle('mode', (_e, mode) => {
  // Color asks every app for its dark theme; Mono asks for the light one, which the shell redraws on parchment.
  nativeTheme.themeSource = mode === 'color' ? 'dark' : 'light';
  return true;
});

// Live updates while the app is open. Sign-ins live on disk, so none of these sign you out.
// style.css: restyled in place. index.html / renderer.js: the window reloads. main.js / preload.js: the app restarts.
function watchForUpdates() {
  if (app.isPackaged) return;
  const files = new Set(['index.html', 'style.css', 'renderer.js', 'config.js', 'main.js', 'preload.js', 'bridge.js', 'updater.js', 'calendar.js']);
  const changed = new Set();
  let timer;
  fs.watch(__dirname, (_ev, file) => {
    if (!file || !files.has(file) || updater.state.busy) return; // an update restarts on its own when it's done
    changed.add(file);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const list = [...changed];
      changed.clear();
      if (!win) return;
      const restart = ['main.js', 'preload.js', 'bridge.js', 'updater.js', 'calendar.js'];
      if (list.some((f) => restart.includes(f))) {
        // Restart only if they all parse: a half-saved file would otherwise stop Monodesk until it's started by hand.
        const broken = restart.find((f) => { try { new vm.Script(fs.readFileSync(path.join(__dirname, f), 'utf8'), { filename: f }); return false; } catch { return true; } });
        if (broken) { win.webContents.send('toast', `${broken} has an error, so Monodesk didn't restart. Fix it and save again.`); return; }
        Promise.race([saveSessions(), new Promise((r) => setTimeout(r, 3000))]).finally(() => { app.relaunch(); app.exit(0); });
      } else if (list.some((f) => f !== 'style.css')) {
        win.webContents.once('did-finish-load', () => win.webContents.send('toast', 'Monodesk updated'));
        win.webContents.reload();
      } else {
        win.webContents.send('css-changed');
      }
    }, 400);
  });
}

updater.ensureConfig();

app.whenReady().then(() => {
  for (const m of APPS) {
    session.fromPartition('persist:' + m).setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.includes(permission));
    });
  }
  nativeTheme.themeSource = 'dark'; // Monodesk opens in Color, with every app in its dark theme
  createWindow();
  makeTray();
  writeShortcuts();
  watchForUpdates();
  // The phone app, at http://127.0.0.1:47800 (tailscale serve shares it with your devices).
  bridge.start();
  app.on('activate', showWin);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
