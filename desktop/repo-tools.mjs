// Read-only repository tools. Paths are checked before content is read, and
// search results retain their structured filenames until final presentation.
// Git accepts a small command-specific grammar and returns metadata only.
import { promises as fs, constants as fsConstants } from 'node:fs';
import { spawnTracked, killTree } from './processes.mjs';
import { safeChildEnv } from './find-claude.mjs';
import nodePath from 'node:path';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.cache', 'target', 'vendor', '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.turbo']);
const SECRET_RE = /^(\.env(\..*)?|.*\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*secrets?\.(json|ya?ml|toml|txt)|\.npmrc|\.netrc|\.pypirc|credentials(\.json)?)$/i;
const MAX_OUT = 40_000;
const MAX_FILES = 10_000;
const displayPath = p => /[:\s\\\x00-\x1f\x7f]/.test(p) ? JSON.stringify(p) : p;
const blocked = rel => {
  const parts = rel.split('/');
  // Reject ambiguous names everywhere, including NTFS alternate streams and
  // Windows aliases that discard trailing dots/spaces. Root '.' is special.
  if (/[:\\\x00-\x1f\x7f\ufffd]/.test(rel) || parts.some(p => p !== '.' && /[. ]$/.test(p))) return 'path uses an unsupported or ambiguous filename';
  if (parts.some(p => SECRET_RE.test(p))) return 'the gatekeeper does not reveal secrets';
  if (parts.some(p => IGNORE_DIRS.has(p.toLowerCase()))) return 'path is excluded from repository tools';
  return null;
};

export function run(cmd, args, { cwd, timeout = 20_000, maxOut = MAX_OUT, signal, env, input } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const child = spawnTracked(cmd, args, { cwd, env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let out = '', err = '', cut = false;
    const onAbort = () => { killTree(child); reject(new Error('aborted')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { killTree(child); reject(new Error(`${cmd} timed out`)); }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { const left = Math.max(0, maxOut - out.length); out += d.slice(0, left); if (d.length > left) cut = true; });
    child.stderr.on('data', d => { err += d.slice(0, Math.max(0, 4000 - err.length)); });
    child.on('error', e => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(e); });
    child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve({ code, out, err, truncated: cut }); });
    if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

// Do not inherit Git configuration injection, repository redirection, pagers,
// helpers, or network/authentication settings from the parent environment.
function gitEnv(root) {
  const env = safeChildEnv(process.env, { repo: root, auth: false });
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return { ...env, GIT_CEILING_DIRECTORIES: nodePath.dirname(root), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: nul, GIT_CONFIG_SYSTEM: nul, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ATTR_NOSYSTEM: '1' };
}
const GIT_SAFE_ARGS = ['--no-pager', '-c', 'core.pager=', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'core.untrackedCache=false', '-c', 'log.showSignature=false', '-c', 'diff.external=', '-c', 'interactive.diffFilter=', '-c', 'protocol.allow=never', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0'];

// Compatibility with old tool calls is deliberately narrow. No free-form refs,
// paths, formats, patch flags, or options from one command reused with another.
function gitCommand(command, args) {
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string' || a.includes('\0'))) throw new Error('args must be strings without NUL bytes');
  if (args.length > 20) throw new Error('too many git arguments');
  const deny = arg => { throw new Error(`git argument not allowed: ${displayPath(arg)}`); };
  if (command === 'log') {
    const result = ['log', '--no-color', '--no-patch', '--no-show-signature', '--format=%h %s'];
    let count = 20;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--oneline') continue;
      if (['--all', '--no-merges', '--merges', '--first-parent', '--reverse', '--graph', '--decorate'].includes(arg)) { result.push(arg); continue; }
      let n;
      if (arg === '-n' || arg === '--max-count') n = args[++i];
      else if (/^(?:-n|--max-count=)\d+$/.test(arg)) n = arg.replace(/^(?:-n|--max-count=)/, '');
      else deny(arg);
      if (!/^\d{1,3}$/.test(n || '') || Number(n) < 1 || Number(n) > 100) deny(String(n));
      count = Number(n);
    }
    return [...result, `--max-count=${count}`, '--'];
  }
  if (command === 'status') {
    for (const arg of args) if (!['-s', '--short', '--porcelain', '--porcelain=v1'].includes(arg)) deny(arg);
    return ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=all'];
  }
  if (command === 'diff') {
    for (const arg of args) if (!['--name-only', '--cached', '--staged'].includes(arg)) deny(arg);
    return ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--name-only', '-z', ...(args.some(a => a === '--cached' || a === '--staged') ? ['--cached'] : []), '--'];
  }
  if (command === 'branch') {
    for (const arg of args) if (!['--list', '-a', '--all', '-r', '--remotes'].includes(arg)) deny(arg);
    return ['branch', '--list', '--no-color', '--format=%(refname:short)', ...(args.some(a => a === '-a' || a === '--all') ? ['--all'] : args.some(a => a === '-r' || a === '--remotes') ? ['--remotes'] : [])];
  }
  throw new Error('command not allowed; git tools expose log, status, diff filenames, and branch lists only');
}

export function repoTools(root, { git = true } = {}) {
  const ROOT = nodePath.resolve(root);
  let realRoot = null, hasRg = null;
  const escapes = rel => rel === '..' || rel.startsWith('..' + nodePath.sep) || nodePath.isAbsolute(rel);
  const relative = (base, path) => nodePath.relative(base, path).split(nodePath.sep).join('/') || '.';
  const executables = new Map();
  async function executable(name) {
    if (executables.has(name)) return executables.get(name);
    realRoot ??= await fs.realpath(ROOT);
    const names = process.platform === 'win32' ? [`${name}.exe`] : [name];
    for (const dir of (process.env.PATH || '').split(nodePath.delimiter)) {
      // A repository or relative PATH entry must never provide our tools.
      if (!nodePath.isAbsolute(dir)) continue;
      for (const file of names) {
        const candidate = await fs.realpath(nodePath.join(dir, file)).catch(() => null);
        if (!candidate || !escapes(nodePath.relative(realRoot, candidate))) continue;
        if (await fs.access(candidate, fsConstants.X_OK).then(() => true, () => false)) { executables.set(name, candidate); return candidate; }
      }
    }
    const e = new Error(`${name} is unavailable outside the repository`); e.code = 'ENOENT'; throw e;
  }
  async function checkGitLayout(metadata, signal) {
    const gitDir = nodePath.join(ROOT, '.git');
    const st = await fs.lstat(gitDir).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    // Linked worktrees/gitfiles and symlinked gitdirs can redirect all metadata
    // outside the selected repository. Support only an ordinary local gitdir.
    if (!st) {
      const present = async file => fs.lstat(nodePath.join(ROOT, file)).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
      if (metadata || (await present('HEAD') && await present('objects'))) throw new Error('Git requires an internal .git directory; bare repositories are not supported');
      return;
    }
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('external Git directories and linked worktrees are not supported');
    for (const file of ['commondir', 'objects/info/alternates', 'objects/info/http-alternates']) {
      if (await fs.lstat(nodePath.join(gitDir, file)).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; })) throw new Error('external Git object stores and shared Git directories are not supported');
    }
    if (!metadata) return;
    let count = 0;
    const walk = async dir => {
      signal?.throwIfAborted();
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (++count > 100_000) throw new Error('Git directory is too large to safely inspect');
        if (entry.isSymbolicLink()) throw new Error('symlinks inside Git metadata are not supported');
        if (entry.isDirectory()) await walk(nodePath.join(dir, entry.name));
        else if (!entry.isFile()) throw new Error('non-regular Git metadata is not supported');
      }
    };
    await walk(gitDir);
  }
  async function safeGit(args, options = {}) {
    await checkGitLayout(args[0] !== 'check-ignore', options.signal);
    const bin = await executable('git');
    const base = [...GIT_SAFE_ARGS, '-c', `core.worktree=${ROOT}`];
    const opts = { cwd: ROOT, env: gitEnv(ROOT), ...options };
    // Even status and filename-only worktree diffs can execute clean/process
    // filters. Enumerate configuration without executing helpers, then disable
    // every configured filter driver. Config must remain stable during the call,
    // just as filesystem paths must not be concurrently replaced with symlinks.
    if (args[0] === 'status' || (args[0] === 'diff' && !args.includes('--cached'))) {
      const config = await run(bin, [...base, 'config', '--includes', '--null', '--name-only', '--get-regexp', '^filter\\.'], { ...opts, maxOut: 100_000 });
      if (![0, 1].includes(config.code) || config.truncated) throw new Error('cannot safely inspect Git filter configuration');
      const drivers = new Set(config.out.split('\0').filter(Boolean).map(key => key.slice(0, key.lastIndexOf('.'))));
      if (drivers.size > 128) throw new Error('too many Git filters to safely disable');
      for (const driver of drivers) {
        if (!/^filter\..+/s.test(driver) || driver.length > 1000) throw new Error('unsupported Git filter configuration');
        for (const key of ['clean', 'smudge', 'process']) base.push('-c', `${driver}.${key}=`);
        base.push('-c', `${driver}.required=false`);
      }
    }
    return run(bin, [...base, ...args], opts);
  }
  const clampInt = (v, lo, hi, d) => Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : d;

  async function inside(p = '.') {
    if (typeof p !== 'string' || p.includes('\0')) throw new Error('path must be a string without NUL bytes');
    const target = nodePath.resolve(ROOT, p);
    if (escapes(nodePath.relative(ROOT, target))) throw new Error('path escapes the repository');
    const lexical = relative(ROOT, target);
    if (blocked(lexical)) throw new Error(blocked(lexical));
    realRoot ??= await fs.realpath(ROOT);
    const real = await fs.realpath(target).catch(() => { throw new Error(`no such path: ${displayPath(p)}`); });
    const rel = relative(realRoot, real);
    if (escapes(nodePath.relative(realRoot, real))) throw new Error('path escapes the repository');
    if (blocked(rel)) throw new Error(blocked(rel));
    return { abs: real, rel, lexical };
  }

  async function ignored(paths, signal) {
    paths = [...new Set(paths.filter(p => p !== '.'))];
    if (!paths.length) return new Set();
    let r;
    try { r = await safeGit(['check-ignore', '--no-index', '-z', '--stdin'], { input: paths.join('\0') + '\0', maxOut: 2_000_000, signal }); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (r && (r.code === 0 || r.code === 1) && !r.truncated) return new Set(r.out.split('\0').filter(Boolean));
    // A plain folder with no ignore rules also works without Git. If ignore
    // rules exist but cannot be evaluated, fail closed instead of bypassing them.
    if (r && !/not a git repository/.test(r.err)) throw new Error('cannot safely evaluate repository ignore rules');
    const dirs = new Set(['.']);
    for (const path of paths) {
      let dir = path;
      while (dir !== '.' && dir !== '/') { dirs.add(dir); dir = nodePath.posix.dirname(dir); }
    }
    for (const dir of dirs) for (const name of ['.git', '.gitignore']) {
      if (await fs.lstat(nodePath.join(ROOT, dir, name)).then(() => true, () => false)) throw new Error('Git is required to safely evaluate repository ignore rules');
    }
    return new Set();
  }

  async function accessible(p, signal) {
    const path = await inside(p);
    if ((await ignored([path.rel, path.lexical], signal)).size) throw new Error('path is excluded by repository ignore rules');
    return path;
  }

  async function entries(dirAbs, base, signal) {
    signal?.throwIfAborted();
    const all = await fs.readdir(dirAbs, { withFileTypes: true });
    all.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    const rows = all.filter(e => !e.isSymbolicLink()).map(e => ({ e, rel: base === '.' ? e.name : `${base}/${e.name}` }));
    const excluded = await ignored(rows.filter(({ rel }) => !blocked(rel)).map(({ rel }) => rel), signal);
    return rows.map(row => ({ ...row, denied: blocked(row.rel) || (excluded.has(row.rel) ? 'ignored' : null) }));
  }

  async function list(dirAbs, base, depth, acc, signal) {
    for (const { e, rel, denied } of await entries(dirAbs, base, signal)) {
      if (acc.length >= 400) return;
      if (denied) { acc.push(`${displayPath(rel)}${e.isDirectory() ? '/' : ''} (${denied.includes('secrets') ? 'withheld' : 'skipped'})`); continue; }
      if (e.isDirectory()) {
        acc.push(`${displayPath(rel)}/`);
        if (depth > 1) await list(nodePath.join(dirAbs, e.name), rel, depth - 1, acc, signal);
      } else if (e.isFile()) {
        const st = await fs.stat(nodePath.join(dirAbs, e.name)).catch(() => null);
        if (st) acc.push(`${displayPath(rel)} (${st.size} B)`);
      }
    }
  }

  async function searchFiles(path, signal) {
    const files = [];
    let visited = 0;
    const walk = async (abs, rel) => {
      if (++visited > MAX_FILES) throw new Error('search scope is too large; choose a subdirectory');
      for (const { e, rel: child, denied } of await entries(abs, rel, signal)) {
        if (denied) continue;
        if (e.isDirectory()) await walk(nodePath.join(abs, e.name), child);
        else if (e.isFile()) {
          if (files.length >= MAX_FILES) throw new Error('search scope is too large; choose a subdirectory');
          files.push(child);
        }
      }
    };
    const st = await fs.stat(path.abs);
    if (st.isDirectory()) await walk(path.abs, path.rel);
    else if (st.isFile()) files.push(path.rel);
    else throw new Error('path is not a regular file or directory');
    return files;
  }

  const tools = [
    {
      name: 'repo_list',
      description: 'List repository files and directories with sizes. Secret paths, ignored files, dependency/build output, VCS folders, and symlinks are withheld or skipped.',
      input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory relative to the repository root. Default: the root.' }, depth: { type: 'integer', description: 'Levels to descend, 1-4. Default 2.' } }, required: [], additionalProperties: false },
      label: i => `SCANNING ${i.path && i.path !== '.' ? i.path : '/'}`,
      async call({ path = '.', depth = 2 } = {}, signal) {
        const { abs, rel } = await accessible(path, signal);
        if (!(await fs.stat(abs)).isDirectory()) throw new Error('path is a file; use repo_read');
        const acc = [];
        await list(abs, rel, clampInt(depth, 1, 4, 2), acc, signal);
        return (acc.length ? acc.join('\n') : '(empty)') + (acc.length >= 400 ? '\n… (truncated; list a subdirectory)' : '');
      },
    },
    {
      name: 'repo_read',
      description: 'Read an allowed repository text file as numbered lines. Secret and ignored paths are unavailable. Long files come back in windows of 400 lines.',
      input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to the repository root.' }, start: { type: 'integer', description: '1-based first line. Default 1.' }, end: { type: 'integer', description: 'Last line (inclusive). Default start + 399.' } }, required: ['path'], additionalProperties: false },
      label: i => `READING ${i.path}`,
      async call({ path, start = 1, end } = {}, signal) {
        if (typeof path !== 'string') throw new Error('path is required');
        const { abs, rel } = await accessible(path, signal);
        const st = await fs.stat(abs);
        if (!st.isFile()) throw new Error('path is not a regular file; use repo_list for directories');
        if (st.size > 4_000_000) throw new Error('file is too large');
        const buf = await fs.readFile(abs, { signal });
        if (buf.subarray(0, 8000).includes(0)) throw new Error('file is binary');
        const lines = buf.toString('utf8').split(/\r?\n/);
        const s = clampInt(start, 1, lines.length, 1), e = clampInt(end, s, Math.min(lines.length, s + 399), Math.min(lines.length, s + 399));
        let out = lines.slice(s - 1, e).map((l, i) => `${s + i}\t${l}`).join('\n');
        if (out.length > MAX_OUT) out = out.slice(0, MAX_OUT) + '\n… (window truncated; ask for fewer lines)';
        return `${displayPath(rel)} (lines ${s}-${e} of ${lines.length})\n${out}`;
      },
    },
    {
      name: 'repo_search',
      description: 'Search allowed repository text files. Returns path:line:text (unusual filenames are JSON-quoted). Secret, ignored, dependency/build, and VCS paths are excluded, including explicit files.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Text to find. Case-insensitive unless regex is true.' }, path: { type: 'string', description: 'Limit the search to this directory or file.' }, regex: { type: 'boolean', description: 'Treat query as a case-sensitive regular expression. Default false.' }, max: { type: 'integer', description: 'Maximum matching lines, 1-200. Default 60.' } }, required: ['query'], additionalProperties: false },
      label: i => `SEARCHING ${JSON.stringify(String(i.query ?? '')).slice(0, 48)}`,
      async call({ query, path = '.', regex = false, max = 60 } = {}, signal) {
        if (typeof query !== 'string' || !query.trim() || query.length > 2000 || query.includes('\0')) throw new Error('query must be 1-2000 characters without NUL bytes');
        const target = await accessible(path, signal);
        const files = await searchFiles(target, signal), limit = clampInt(max, 1, 200, 60), matches = [];
        hasRg ??= await executable('rg').then(bin => run(bin, ['--no-config', '--version'], { signal, env: safeChildEnv(process.env, { repo: ROOT, auth: false }) })).then(r => r.code === 0, e => { if (signal?.aborted) throw e; return false; });
        if (hasRg) {
          for (let i = 0; i < files.length && matches.length < limit; i += 100) {
            const batch = files.slice(i, i + 100);
            // Explicit approved files plus --no-ignore make both backends use
            // exactly the same policy. --no-config prevents local preprocessors.
            const r = await run(await executable('rg'), ['--no-config', '--json', '--no-ignore', '--line-number', '--color', 'never', '--max-count', '25', '--max-filesize', '1000000', ...(regex ? [] : ['-F', '-i']), '-e', query, '--', ...batch], { cwd: ROOT, maxOut: 2_000_000, signal, env: safeChildEnv(process.env, { repo: ROOT, auth: false }) });
            if (r.code !== 0 && r.code !== 1) throw new Error('repository search failed; check the regular expression');
            if (r.truncated) throw new Error('search output is too large; narrow the search');
            for (const line of r.out.split('\n').filter(Boolean)) {
              const record = JSON.parse(line);
              if (record.type !== 'match') continue;
              const data = record.data;
              // Do not decode lossy byte paths or guess filenames from content.
              if (typeof data.path?.text !== 'string' || typeof data.lines?.text !== 'string' || !Number.isInteger(data.line_number)) continue;
              const rel = data.path.text.replace(/^\.\//, '');
              if (!batch.includes(rel)) throw new Error('unexpected search result path');
              await accessible(rel, signal);
              matches.push({ path: rel, line: data.line_number, text: data.lines.text.replace(/\r?\n$/, '').slice(0, 240) });
              if (matches.length >= limit) break;
            }
          }
        } else {
          if (regex) throw new Error('regular-expression search requires ripgrep; use literal search instead');
          const needle = query.toLowerCase();
          for (const file of files) {
            if (matches.length >= limit) break;
            const { abs, rel } = await accessible(file, signal);
            const st = await fs.stat(abs);
            if (!st.isFile() || st.size > 1_000_000) continue;
            const buf = await fs.readFile(abs, { signal });
            if (buf.subarray(0, 8000).includes(0)) continue;
            let count = 0;
            for (const [index, text] of buf.toString('utf8').split(/\r?\n/).entries()) {
              if (matches.length >= limit || count >= 25) break;
              if (text.toLowerCase().includes(needle)) { matches.push({ path: rel, line: index + 1, text: text.slice(0, 240) }); count++; }
            }
          }
        }
        if (!matches.length) return 'no matches';
        return matches.map(m => `${displayPath(m.path)}:${m.line}:${m.text}`).join('\n').slice(0, MAX_OUT);
      },
    },
  ];

  if (git) tools.push({
    name: 'repo_git',
    description: 'Read-only Git metadata: log (subjects only; --oneline, -n 1..100, --all, --no-merges, --merges, --first-parent, --reverse, --graph, --decorate), status (--short/--porcelain), diff (filenames only; --cached/--staged), branch (list only; --all/--remotes). No file content, patches, object lookups, arbitrary refs, paths, formats, or branch changes.',
    input_schema: { type: 'object', properties: { command: { type: 'string', enum: ['log', 'status', 'diff', 'branch'] }, args: { type: 'array', items: { type: 'string' }, description: 'Only the command-specific flags listed in the tool description. Defaults are safe metadata output.' } }, required: ['command'], additionalProperties: false },
    label: i => `GIT ${String(i.command || '').toUpperCase()}`,
    async call({ command, args = [] } = {}, signal) {
      const argv = gitCommand(command, args);
      const r = await safeGit(argv, { signal });
      if (r.code !== 0) throw new Error(`git ${command} failed`);
      if (r.truncated) throw new Error('git output is too large; narrow the request');
      if (command === 'diff') return r.out.split('\0').filter(Boolean).map(displayPath).join('\n') || '(no output)';
      if (command === 'status') {
        const fields = r.out.split('\0'), rows = [];
        for (let i = 0; i < fields.length; i++) {
          if (!fields[i]) continue;
          const status = fields[i].slice(0, 2), path = fields[i].slice(3);
          const from = /[RC]/.test(status) ? fields[++i] : null;
          rows.push(`${status} ${displayPath(path)}${from ? ` (from ${displayPath(from)})` : ''}`);
        }
        return rows.join('\n') || '(no output)';
      }
      return r.out.trim() || '(no output)';
    },
  });
  return tools;
}
