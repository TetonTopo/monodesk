// Updates from GitHub. The 𝕸 in the top bar shows the version and offers an update when a newer one is on GitHub.
// A git checkout updates with `git pull`; a downloaded zip gets the newest zip copied over it.
// config.js (your settings) is never touched. Dispatch, if it's next to Monodesk, updates along with it.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');

const REPO = 'TetonTopo/monodesk';
const DISPATCH_REPO = 'TetonTopo/dispatch';
const DIR = __dirname;
const KEEP = new Set(['config.js', 'node_modules', '.git', 'Monodesk.lnk']); // never overwritten by a zip update

const state = { busy: false };

const sh = (cmd, args, cwd) => new Promise((res, rej) => execFile(cmd, args, { cwd, windowsHide: true, timeout: 180000 }, (err, out, errOut) => (err ? rej(new Error((errOut || err.message).trim())) : res(out.trim()))));
const readPkg = (dir = DIR) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const deps = (p) => JSON.stringify([p.dependencies || {}, p.devDependencies || {}]);

// 1.2.10 > 1.2.9
function newer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function version() { return readPkg().version; }

// What's on GitHub. The API (not raw.githubusercontent.com) so a just-published version shows up right away.
async function check() {
  const current = version();
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/package.json?ref=main`, { headers: { Accept: 'application/vnd.github.raw+json', 'User-Agent': 'Monodesk' }, cache: 'no-store' });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const latest = JSON.parse(await r.text()).version;
  return { current, latest, available: newer(latest, current) };
}

const dispatchDir = () => path.resolve(process.env.MONODESK_DISPATCH || path.join(DIR, '..', 'dispatch'));

async function hasGit(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return false;
  try { await sh('git', ['--version'], dir); return true; } catch { return false; }
}

// Downloads repo's main branch as a zip and copies it over dir, skipping KEEP.
async function fromZip(repo, dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'monodesk-update-'));
  try {
    const r = await fetch(`https://codeload.github.com/${repo}/zip/refs/heads/main`, { headers: { 'User-Agent': 'Monodesk' } });
    if (!r.ok) throw new Error(`Download failed (${r.status})`);
    const zip = path.join(tmp, 'update.zip');
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    // Windows 10+ and macOS have a tar that reads zips; Linux uses unzip.
    // On Windows, name System32's tar: Git's GNU tar can come first on PATH and can't read zips.
    if (process.platform === 'linux') await sh('unzip', ['-q', zip, '-d', tmp], tmp);
    else await sh(process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-xf', zip, '-C', tmp], tmp);
    const top = fs.readdirSync(tmp).find((n) => n !== 'update.zip' && fs.statSync(path.join(tmp, n)).isDirectory());
    if (!top) throw new Error('The download was empty');
    const src = path.join(tmp, top);
    for (const name of fs.readdirSync(src)) {
      if (KEEP.has(name)) continue;
      fs.cpSync(path.join(src, name), path.join(dir, name), { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function updateDir(repo, dir) {
  if (await hasGit(dir)) {
    try { await sh('git', ['pull', '--ff-only'], dir); } catch (e) { throw new Error(`git pull failed in ${path.basename(dir)}: ${e.message.split('\n')[0]}`); }
  } else {
    await fromZip(repo, dir);
  }
}

// Updates Monodesk (and Dispatch), then restarts. If Electron's version changed, npm install runs first.
async function update() {
  if (state.busy) throw new Error('Already updating');
  state.busy = true;
  try {
    const before = readPkg();
    await updateDir(REPO, DIR);
    const dd = dispatchDir();
    if (fs.existsSync(path.join(dd, 'index.html'))) await updateDir(DISPATCH_REPO, dd).catch(() => {});
    const after = readPkg();
    if (deps(before) !== deps(after) && process.platform === 'win32') {
      // Electron can't replace itself while running, so Start Monodesk.cmd installs and then starts it.
      fs.writeFileSync(path.join(DIR, '.needs-install'), '');
      spawn('cmd.exe', ['/c', 'Start Monodesk.cmd'], { cwd: DIR, detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.exit(0), 300);
    } else {
      setTimeout(() => { app.relaunch(); app.exit(0); }, 300);
    }
    return { ok: true, version: after.version };
  } catch (e) {
    state.busy = false;
    throw e;
  }
}

// config.js is yours and isn't in the repo; the first run makes it from config.example.js.
function ensureConfig() {
  const cfg = path.join(DIR, 'config.js'), example = path.join(DIR, 'config.example.js');
  if (!fs.existsSync(cfg) && fs.existsSync(example)) fs.copyFileSync(example, cfg);
}

module.exports = { state, version, check, update, ensureConfig };
