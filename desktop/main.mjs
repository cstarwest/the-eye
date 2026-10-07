// Gatekeeper desktop app. One window showing the page (index.html, loaded from
// disk), and the bridge running in this process: the window talks to it over
// IPC, so nothing listens on a port and nothing reaches the network except
// what Claude Code or the Claude API do themselves.
//
//   npm start                     this checkout's repository, auto-detected oracle
//   npm start -- /path/to/repo    another repository (remembered)
//   gatekeeper /path/to/repo      the same, for the packaged app
import { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } from 'electron';
import { access, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridge } from './bridge.mjs';
import { adoptLoginShellEnv } from './find-claude.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
if (process.env.GATEKEEPER_USER_DATA) app.setPath('userData', resolve(process.env.GATEKEEPER_USER_DATA));

// a folder given on the command line: the last argument that is not a switch or the app itself
const repoArg = argv => argv.slice(app.isPackaged ? 1 : 2).filter(a => !a.startsWith('-') && resolve(a) !== root).pop() || null;

if (!app.requestSingleInstanceLock()) app.quit();
else main();

function main() {
  app.setName('Gatekeeper');
  let win = null, bridge = null;
  const ready = (async () => {
    // launched from the Dock, Finder or a desktop launcher, the app gets a bare PATH;
    // the login shell's PATH is what finds `claude` (and the node it may need)
    if (process.platform !== 'win32' && process.env.GATEKEEPER_SHELL_ENV !== '0') await adoptLoginShellEnv(process.env);
    bridge = await createBridge({
      settingsFile: join(app.getPath('userData'), 'settings.json'),
      mcpFallback: join(app.getPath('userData'), 'mcp.json'),
      repo: repoArg(process.argv),
      defaultRepo: app.isPackaged ? null : process.cwd(),
      log,
    });
    log(`settings: ${bridge.settingsFile}`);
    return bridge;
  })();
  const broadcast = st => { if (win && !win.isDestroyed()) win.webContents.send('gk:status', st); return st; };

  async function chooseRepo() {
    const b = await ready;
    const r = await dialog.showOpenDialog(win, { title: 'Choose the repository the gatekeeper reads', properties: ['openDirectory'], defaultPath: b.status().repoPath || app.getPath('home') });
    if (r.canceled || !r.filePaths[0]) return b.status();
    return broadcast(await b.setRepo(r.filePaths[0]));
  }
  const redetect = async () => broadcast(await (await ready).setup());

  ipcMain.handle('gk:status', async () => (await ready).status());
  ipcMain.handle('gk:redetect', redetect);
  ipcMain.handle('gk:choose-repo', chooseRepo);
  ipcMain.handle('gk:ask', async (e, { id, question, session: s } = {}) => {
    const b = await ready;
    try { return { ok: true, answer: await b.ask({ id, question, session: s }, ev => { if (!e.sender.isDestroyed()) e.sender.send('gk:event', id, ev); }) }; }
    catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });
  ipcMain.on('gk:cancel', async (_e, id) => (await ready).cancel(id));

  function createWindow() {
    win = new BrowserWindow({
      width: 1280, height: 820, minWidth: 420, minHeight: 560,
      backgroundColor: '#050505', title: 'Gatekeeper', show: false, autoHideMenuBar: true,
      webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    });
    win.once('ready-to-show', () => win.show());
    // the window only ever shows the page: no navigation, no new windows
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => { bridge?.cancelAll(); win = null; });
    win.loadFile(join(root, 'index.html'));
  }

  function menu() {
    const mac = process.platform === 'darwin';
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(mac ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [
        { label: 'Choose Repository…', accelerator: 'CmdOrCtrl+O', click: () => chooseRepo() },
        { label: 'Find Claude Code Again', click: () => redetect() },
        { type: 'separator' },
        { label: 'Open Settings File', click: async () => { const f = (await ready).settingsFile; await access(f).catch(() => writeFile(f, '{}\n')); shell.openPath(f); } },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ] },
      { role: 'editMenu' },
      { label: 'View', submenu: [
        { role: 'togglefullscreen' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
      ] },
      { role: 'windowMenu' },
    ]));
  }

  app.on('second-instance', async (_e, argv) => {
    const dir = repoArg(argv);
    if (dir) { try { broadcast(await (await ready).setRepo(dir)); } catch (e) { log(e.message); } }
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));   // the page asks for nothing
    session.defaultSession.setSpellCheckerEnabled(false);                                 // and no dictionaries are fetched
    menu(); createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('will-quit', () => { bridge?.close(); });
}
