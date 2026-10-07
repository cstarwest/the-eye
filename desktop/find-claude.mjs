// Finds the Claude Code CLI on this machine, the way a desktop app has to: an
// app opened from the Dock, the Start menu or a launcher does not inherit the
// PATH your terminal has, so the login shell is asked for it, and the usual
// install locations are checked as well.
//
//   loginShellEnv()   resolves PATH and ANTHROPIC_* from your login shell (macOS, Linux)
//   findClaude()      resolves { path, command, args, version } for the first `claude`
//                     that answers --version, or null (pass `tried: []` to
//                     collect why each candidate was passed over)
import { spawn } from 'node:child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, isAbsolute } from 'node:path';

const MARK = '__GATEKEEPER_ENV__';

// stdout and exit code of a command, never through a shell; -1 when it cannot start or runs out of time
function run(command, args, { env, timeout }) {
  return new Promise(res => {
    let out = '', done = false, child, timer;
    const finish = code => { if (!done) { done = true; clearTimeout(timer); res({ code, out }); } };
    try { child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); } catch { return finish(-1); }
    timer = setTimeout(() => { child.kill(); finish(-1); }, timeout);
    child.stdout.on('data', d => { if (out.length < 1e6) out += d; });
    child.on('error', () => finish(-1));
    child.on('close', code => finish(code));
  });
}

// Runs the user's login shell once and reads back its environment. Only PATH
// and the ANTHROPIC_* variables are taken.
export async function loginShellEnv({ env = process.env, platform = process.platform, timeout = 5000 } = {}) {
  if (platform === 'win32') return {};
  const shell = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  const r = await run(shell, ['-ilc', `echo ${MARK}; env; echo ${MARK}`], {
    timeout, env: { ...env, DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTARTED: 'true', ZSH_TMUX_AUTOSTART: 'false' },
  });
  const body = r.out.split(MARK)[1] || '';
  const out = {};
  for (const line of body.split('\n')) {
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i);
    if (k === 'PATH' || /^ANTHROPIC_[A-Z_]+$/.test(k)) out[k] = line.slice(i + 1);
  }
  return out;
}

// Adds what the login shell knows to this process: PATH entries it is missing
// (appended, so a PATH you launched with still wins) and ANTHROPIC_* variables
// that are not already set. Children (claude, MCP servers, git) inherit it.
export async function adoptLoginShellEnv(env = process.env, opts = {}) {
  const shell = await loginShellEnv({ env, ...opts });
  if (shell.PATH) {
    const have = (env.PATH || '').split(delimiter).filter(Boolean);
    env.PATH = [...have, ...shell.PATH.split(delimiter).filter(p => p && !have.includes(p))].join(delimiter);
  }
  for (const [k, v] of Object.entries(shell)) if (k !== 'PATH' && !env[k]) env[k] = v;
  return shell;
}

const isFile = p => { try { return statSync(p).isFile(); } catch { return false; } };

// Where installers put it, after PATH.
export function knownLocations({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  if (platform === 'win32') {
    const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
    return [join(home, '.local', 'bin', 'claude.exe'), join(appData, 'npm', 'claude.cmd'), join(home, '.claude', 'local', 'claude.exe')];
  }
  return [
    join(home, '.local', 'bin', 'claude'), join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude',
    join(home, '.npm-global', 'bin', 'claude'), join(home, '.bun', 'bin', 'claude'), join(home, '.volta', 'bin', 'claude'),
  ];
}

export function onPath(name, { env = process.env, platform = process.platform } = {}) {
  const exts = platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  const found = [];
  for (const dir of (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean))
    for (const ext of exts) { const p = join(dir, name + ext); if (isFile(p)) found.push(p); }
  return found;
}

// How to start a candidate without a shell. On Windows an npm install leaves a
// claude.cmd shim, and Node will not run a .cmd without one (and a shell would
// re-parse the question as a command line), so the shim is followed to what it
// starts: the native claude.exe the package ships, or cli.js under node.
export function launchFor(file, { env = process.env, platform = process.platform } = {}) {
  if (!/\.cmd$/i.test(file)) return { command: file, args: [] };
  const pkg = join(dirname(file), 'node_modules', '@anthropic-ai', 'claude-code');
  const exe = join(pkg, 'bin', 'claude.exe');
  if (isFile(exe)) return { command: exe, args: [] };
  const cli = join(pkg, 'cli.js');
  if (isFile(cli)) {
    const node = [join(dirname(file), 'node.exe'), ...onPath('node', { env, platform })].find(isFile);
    if (node) return { command: node, args: [cli] };
  }
  try {   // any other shim: the first .exe or .js it names, relative to the shim
    const m = readFileSync(file, 'utf8').match(/"%~?dp0%?\\([^"]+\.(exe|js))"/i);
    if (m) {
      const target = join(dirname(file), m[1]);
      if (m[2].toLowerCase() === 'exe' && isFile(target)) return { command: target, args: [] };
      const node = onPath('node', { env, platform })[0];
      if (node && isFile(target)) return { command: node, args: [target] };
    }
  } catch {}
  return null;
}

async function version(launch, env) {
  const r = await run(launch.command, [...launch.args, '--version'], { env, timeout: 15000 });
  if (r.code !== 0) return null;
  return r.out.trim().split('\n')[0].replace(/\s*\(Claude Code\)\s*$/i, '') || 'unknown';
}

// The first candidate that answers `--version`: CLAUDE_BIN when set, then PATH,
// then the known install locations.
export async function findClaude({ env = process.env, platform = process.platform, home = homedir(), bin = env.CLAUDE_BIN, tried = [] } = {}) {
  const candidates = bin
    ? (isAbsolute(bin) || /[\\/]/.test(bin) ? [bin] : onPath(bin, { env, platform }))
    : [...onPath('claude', { env, platform }), ...knownLocations({ env, platform, home })];
  if (bin && !candidates.length) tried.push(`${bin}: not on PATH`);
  for (const path of candidates.filter((p, i, a) => a.indexOf(p) === i)) {
    if (!existsSync(path)) { if (bin) tried.push(`${path}: not found`); continue; }
    const launch = launchFor(path, { env, platform });
    if (!launch) { tried.push(`${path}: cannot tell what it starts`); continue; }
    const v = await version(launch, env);
    if (v) return { path, ...launch, version: v };
    tried.push(`${path}: did not answer --version`);
  }
  return null;
}
