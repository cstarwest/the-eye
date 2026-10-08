// Finds the Claude Code CLI on this machine, the way a desktop app has to: an
// app opened from the Dock, the Start menu or a launcher does not inherit the
// PATH your terminal has, so the login shell is asked for it, and the usual
// install locations are checked as well.
//
//   loginShellEnv()   resolves PATH and ANTHROPIC_* from your login shell (macOS, Linux)
//   findClaude()      resolves { path, command, args, version } for the first `claude`
//                     that answers --version, or null (pass `tried: []` to
//                     collect why each candidate was passed over)
import { spawnTracked, killTree } from './processes.mjs';
import { existsSync, statSync, readdirSync, realpathSync, accessSync, constants } from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, isAbsolute, resolve, relative, sep, win32 } from 'node:path';

const MARK = '__GATEKEEPER_ENV__';

// stdout and exit code of a command, never through a shell; -1 when it cannot start or runs out of time
export function probeProcess(command, args, { env, cwd, timeout = 15000 }) {
  return new Promise(res => {
    let out = '', done = false, child, timer;
    const finish = code => { if (!done) { done = true; clearTimeout(timer); res({ code, out }); } };
    try { child = spawnTracked(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return finish(-1); }
    timer = setTimeout(() => { killTree(child); finish(-1); }, timeout);
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
  if (!isAbsolute(shell) || !isExecutable(shell, platform)) return {};
  const cwd = isAbsolute(env.HOME || '') ? env.HOME : homedir();
  const r = await probeProcess(shell, ['-ilc', `echo ${MARK}; env; echo ${MARK}`], {
    timeout, cwd, env: { ...safeChildEnv(env), DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTARTED: 'true', ZSH_TMUX_AUTOSTART: 'false' },
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
    const have = safePath(env.PATH || '').split(delimiter).filter(Boolean);
    env.PATH = [...have, ...safePath(shell.PATH).split(delimiter).filter(p => p && !have.includes(p))].join(delimiter);
  }
  for (const [k, v] of Object.entries(shell)) if (k !== 'PATH' && !env[k]) env[k] = v;
  return shell;
}

const isFile = p => { try { return statSync(p).isFile(); } catch { return false; } };
const dirs = p => { try { return readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; } };
const newerFirst = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) - (x[i] || 0);
  return 0;
};

// PATH is executable authority, not repository data. Empty/relative entries
// (including ".") and paths resolving inside the selected repository are ignored.
export function isWithin(root, file) {
  if (!root) return false;
  const rel = relative(resolve(root), resolve(file));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}
function real(file) { try { return realpathSync(file); } catch { return resolve(file); } }
export function isRepoPath(file, repo) { return !!repo && (isWithin(repo, file) || isWithin(real(repo), real(file))); }
const absolute = (p, platform) => platform === 'win32' ? win32.isAbsolute(p) || isAbsolute(p) : isAbsolute(p);
const isExecutable = (p, platform = process.platform) => {
  try { if (!statSync(p).isFile()) return false; if (platform !== 'win32') accessSync(p, constants.X_OK); return true; } catch { return false; }
};
export function safePath(value, { platform = process.platform, repo } = {}) {
  return [...new Set(String(value || '').split(platform === 'win32' ? ';' : delimiter)
    .filter(p => p && absolute(p, platform) && !isRepoPath(p, repo)))].join(platform === 'win32' ? ';' : delimiter);
}

// Do not inherit runtime injection (NODE_OPTIONS, LD_*, DYLD_*), shell startup,
// git overrides, Claude wrappers, auto-IDE connections, or arbitrary app secrets.
// Home is retained only for Claude's normal subscription authentication.
export function safeChildEnv(source = process.env, { repo, platform = process.platform, auth = true } = {}) {
  const out = {};
  const keys = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
    'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMP', 'TEMP', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];
  if (auth) keys.push('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL');
  for (const k of keys) if (typeof source[k] === 'string') out[k] = source[k];
  out.PATH = safePath(source.PATH || source.Path, { repo, platform });
  // Native npm-installed CLI launchers can require node from PATH. Never restore
  // a relative or repository-local directory while normalizing it.
  out.DISABLE_AUTOUPDATER = '1';
  out.CLAUDE_CODE_AUTO_CONNECT_IDE = '0';
  out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return out;
}

// Discovery probes receive neither login credentials nor user/project config.
// --version/--help do not need either. Never probe from the selected repository.
export async function withProbeEnvironment(env, callback, { repo, platform = process.platform } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'gatekeeper-cli-probe-'));
  try {
    await mkdir(join(cwd, 'config'), { mode: 0o700 });
    const childEnv = safeChildEnv(env, { repo, platform, auth: false });
    Object.assign(childEnv, { HOME: cwd, USERPROFILE: cwd, APPDATA: cwd, LOCALAPPDATA: cwd, CLAUDE_CONFIG_DIR: join(cwd, 'config') });
    return await callback({ cwd, env: childEnv });
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

// The copy the Claude desktop app keeps for itself, under
// <app data>/claude-code/<version>/<build>/claude, newest version first. The
// Microsoft Store build is an MSIX package, so Windows keeps its %APPDATA%
// under %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming, where only the
// package itself sees it at the usual path; both places are looked in.
export function desktopAppCopies({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  let roots;
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || join(home, 'AppData', 'Local'), packages = join(localAppData, 'Packages');
    roots = [join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude-code'),
      ...dirs(packages).filter(d => /^Claude_/i.test(d)).map(d => join(packages, d, 'LocalCache', 'Roaming', 'Claude', 'claude-code'))];
  } else roots = [platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude', 'claude-code')
    : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'claude-code')];
  const exe = platform === 'win32' ? 'claude.exe' : 'claude';
  return roots.flatMap(root => dirs(root).filter(v => /^\d+(\.\d+)*$/.test(v)).map(v => ({ v, dir: join(root, v) })))
    .sort((a, b) => newerFirst(a.v, b.v))
    .flatMap(({ dir }) => dirs(dir).map(b => join(dir, b, exe)).filter(isFile));
}

// Where installers put it, after PATH; the desktop app's own copy last.
export function knownLocations({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  const app = desktopAppCopies({ env, platform, home });
  if (platform === 'win32') {
    const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
    return [join(home, '.local', 'bin', 'claude.exe'), join(appData, 'npm', 'claude.cmd'), join(home, '.claude', 'local', 'claude.exe'), ...app];
  }
  return [
    join(home, '.local', 'bin', 'claude'), join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude',
    join(home, '.npm-global', 'bin', 'claude'), join(home, '.bun', 'bin', 'claude'), join(home, '.volta', 'bin', 'claude'),
    ...app,
  ];
}

export function onPath(name, { env = process.env, platform = process.platform, repo } = {}) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return [];
  const exts = platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  const found = [];
  for (const dir of safePath(env.PATH || env.Path, { platform, repo }).split(platform === 'win32' ? ';' : delimiter).filter(Boolean))
    for (const ext of exts) { const p = join(dir, name + ext); if (isExecutable(p, platform) && !isRepoPath(p, repo)) found.push(p); }
  return found;
}

// How to start a candidate without a shell. On Windows an npm install leaves a
// claude.cmd shim, and Node will not run a .cmd without one (and a shell would
// re-parse the question as a command line), so the shim is followed to what it
// starts: the native claude.exe the package ships, or cli.js under node.
export function launchFor(file, { env = process.env, platform = process.platform, repo } = {}) {
  if (!absolute(file, platform) || isRepoPath(file, repo)) return null;
  if (!/\.cmd$/i.test(file)) return { command: file, args: [] };
  const pkg = join(dirname(file), 'node_modules', '@anthropic-ai', 'claude-code');
  const exe = join(pkg, 'bin', 'claude.exe');
  if (isFile(exe) && !isRepoPath(exe, repo)) return { command: exe, args: [] };
  const cli = join(pkg, 'cli.js');
  if (isFile(cli) && !isRepoPath(cli, repo)) {
    const node = [join(dirname(file), 'node.exe'), ...onPath('node', { env, platform, repo })].find(p => isExecutable(p, platform) && !isRepoPath(p, repo));
    if (node) return { command: node, args: [cli] };
  }
  // Do not interpret arbitrary .cmd contents or follow script-supplied targets.
  return null;
}

async function version(launch, env, options) {
  return withProbeEnvironment(env, async context => {
    const r = await probeProcess(launch.command, [...launch.args, '--version'], { ...context, timeout: 15000 });
    if (r.code !== 0) return null;
    // An unrelated executable printing arbitrary text is not Claude Code.
    const match = r.out.trim().match(/^(\d+\.\d+\.\d+(?:-[\w.-]+)?) \(Claude Code\)$/);
    return match?.[1] || null;
  }, options);
}

// Installed executables are trusted local code, never validated by their name
// or --version alone. In particular, a repository cannot supply a PATH candidate.
export async function findClaude({ env = process.env, platform = process.platform, home = homedir(), bin = env.CLAUDE_BIN, repo, tried = [] } = {}) {
  const candidates = bin
    ? (absolute(bin, platform) ? [bin] : /[\\/]/.test(bin) ? [] : onPath(bin, { env, platform, repo }))
    : [...onPath('claude', { env, platform, repo }), ...knownLocations({ env, platform, home })];
  if (bin && !candidates.length) tried.push(`${bin}: must be an absolute installed executable or a name on an absolute PATH`);
  for (const path of candidates.filter((p, i, a) => a.indexOf(p) === i)) {
    if (!existsSync(path)) { if (bin) tried.push(`${path}: not found`); continue; }
    if (isRepoPath(path, repo)) { tried.push(`${path}: repository-local executable is not trusted`); continue; }
    if (!isExecutable(path, platform)) { tried.push(`${path}: not executable`); continue; }
    const launch = launchFor(path, { env, platform, repo });
    if (!launch) { tried.push(`${path}: cannot tell what it starts`); continue; }
    const v = await version(launch, env, { repo, platform });
    if (v) return { path, ...launch, version: v };
    tried.push(`${path}: did not answer --version as Claude Code`);
  }
  return null;
}
