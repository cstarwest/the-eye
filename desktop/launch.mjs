// Launcher: what the double-click files at the top of the repository run
// (Gatekeeper.command on macOS, Gatekeeper.cmd on Windows, gatekeeper.sh on Linux).
//
//   node desktop/launch.mjs [/path/to/repo]
//
// It installs the dependencies when they are missing or older than package-lock.json,
// starts the desktop app, and stays with it: when the app closes the launcher exits
// with it, and when the launcher is stopped (its terminal window closed, Ctrl+C, a
// kill) the app is told to quit, which stops everything the app started.
import { runtimeError } from './security.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const say = m => console.log(`gatekeeper: ${m}`);
const die = m => { console.error(`gatekeeper: ${m}`); process.exit(1); };

const unsafeRuntime = runtimeError();
if (unsafeRuntime) die(unsafeRuntime);

// dependencies: missing, or older than the lockfile
const mtime = p => { try { return statSync(p).mtimeMs; } catch { return 0; } };
const installed = join(root, 'node_modules', '.package-lock.json');
if (!existsSync(join(root, 'node_modules', 'electron')) || mtime(join(root, 'package-lock.json')) > mtime(installed)) {
  say('installing dependencies (the first run takes a minute)…');
  // fixed arguments only, so the shell Windows needs for npm.cmd has nothing to interpret
  const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['ci', '--no-fund', '--no-audit'], { cwd: root, stdio: 'inherit', shell: WIN });
  if (r.status !== 0) die('npm ci failed; see above.');
}

let electron;
try { electron = createRequire(join(root, 'package.json'))('electron'); } catch {}
if (typeof electron !== 'string' || !existsSync(electron)) die('Electron is not installed. Run npm install in this folder.');

const args = [root, ...process.argv.slice(2)];
const env = { ...process.env, GATEKEEPER_LAUNCHER_PID: String(process.pid) }; delete env.ELECTRON_RUN_AS_NODE;   // set, it would start Electron as plain Node
// its own process group: a closed terminal or Ctrl+C reaches only the launcher, which asks the app to quit
// properly; signalled directly, Electron's helper processes would die first and take the app down uncleanly
const app = spawn(electron, args, { cwd: root, stdio: 'inherit', env, detached: !WIN });
say(`started (pid ${app.pid})`);

// the launcher goes, the app goes: a signal asks it to quit (it then stops what it started);
// if it is still there after a few seconds, or on Windows where there is no polite signal, the tree is ended
let stopping = false;
function stop(sig) {
  if (stopping || app.exitCode !== null) return; stopping = true;
  if (WIN) { spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); return; }
  app.kill(sig === 'SIGHUP' ? 'SIGTERM' : sig);
  setTimeout(() => { if (app.exitCode === null) app.kill('SIGKILL'); }, 8000).unref();
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(sig));
app.on('exit', (code, signal) => { say('closed'); process.exit(code ?? (signal ? 1 : 0)); });
app.on('error', e => die(`could not start the app: ${e.message}`));
