// Gatekeeper desktop app. One window showing the page (index.html, loaded from
// disk), and the bridge running in this process: the window talks to it over
// IPC, so nothing listens on a port and nothing reaches the network except
// what Claude Code or the Claude API do themselves.
//
// Closing the window quits the app on every platform and requests best-effort
// cleanup of tracked processes and MCP clients before exiting (see SECURITY.md).
//
//   npm start                     this checkout's repository, auto-detected oracle
//   npm start -- /path/to/repo    another repository (remembered)
//   gatekeeper /path/to/repo      the same, for the packaged app
import { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } from 'electron';
import { access, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runtimeError, trustedSender } from './security.mjs';
import { createBridge } from './bridge.mjs';
import { adoptLoginShellEnv } from './find-claude.mjs';
import { stopAll, killAllNow, liveCount } from './processes.mjs';

const unsafeRuntime = runtimeError();
if (unsafeRuntime) { console.error(unsafeRuntime); app.exit(1); }

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
if (process.env.GATEKEEPER_USER_DATA) app.setPath('userData', resolve(process.env.GATEKEEPER_USER_DATA));

// a folder given on the command line: the last argument that is not a switch or the app itself
const repoArg = argv => argv.slice(app.isPackaged ? 1 : 2).filter(a => !a.startsWith('-') && resolve(a) !== root).pop() || null;

if (unsafeRuntime) { /* Never start the bridge in an unsafe runtime. */ }
else if (!app.requestSingleInstanceLock()) app.quit();
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

  const pageUrl = pathToFileURL(join(root, 'index.html')).href;
  const verify = e => { if (!trustedSender(e, win, pageUrl)) throw new Error('untrusted IPC sender'); };
  ipcMain.handle('gk:status', async e => { verify(e); return (await ready).status(); });
  ipcMain.handle('gk:redetect', async e => { verify(e); return redetect(); });
  ipcMain.handle('gk:choose-repo', async e => { verify(e); return chooseRepo(); });
  ipcMain.handle('gk:ask', async (e, { id, question, session: s } = {}) => {
    verify(e);
    const b = await ready;
    try { return { ok: true, answer: await b.ask({ id, question, session: s }, ev => { if (!e.sender.isDestroyed()) e.sender.send('gk:event', id, ev); }) }; }
    catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });
  ipcMain.on('gk:cancel', async (e, id) => { if (trustedSender(e, win, pageUrl)) (await ready).cancel(id); });

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
  // no spellchecker, so no dictionaries are fetched: switched off as each session is made, before it can start a download
  app.on('session-created', ses => { ses.setSpellCheckerEnabled(false); if (process.platform !== 'darwin') ses.setSpellCheckerLanguages([]); });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));   // the page asks for nothing
    menu(); createWindow();
  });
  // the window is the app: closing it quits, on macOS too
  app.on('window-all-closed', () => app.quit());
  // Quitting cancels questions, closes MCP clients and signals tracked process
  // groups. Detached or already-untracked descendants are outside this guarantee.
  let stopped = false;
  app.on('will-quit', e => {
    if (stopped) return;
    e.preventDefault();
    (async () => {
      const left = liveCount();
      await Promise.race([(async () => { bridge?.cancelAll(); await bridge?.close(); })(), new Promise(r => setTimeout(r, 3000))]).catch(() => {});
      await stopAll(2000);
      if (left) log(`requested cleanup for ${left} process${left === 1 ? '' : 'es'}`);
    })().finally(() => { stopped = true; app.exit(0); });   // cleanup was attempted; this is not proof every descendant exited
  });
  // a terminal's Ctrl+C, a closed terminal or a kill: quit the same way
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => app.quit());
  // and if the app goes down any other way, take the trees with it
  process.on('exit', killAllNow);
  // started by the launcher (desktop/launch.mjs): if the launcher is gone, however it went, quit
  const launcher = Number(process.env.GATEKEEPER_LAUNCHER_PID);
  if (launcher) setInterval(() => { try { process.kill(launcher, 0); } catch { app.quit(); } }, 1000).unref();
}
