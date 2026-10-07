// Read-only tools over the repository, executed locally in API mode.
// Every path the model supplies is untrusted: it is resolved under the root and
// checked both lexically and through realpath (symlinks). Files that look like
// secrets are never returned. Git runs with an argument allowlist.
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import nodePath from 'node:path';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.cache', 'target', 'vendor', '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.turbo']);
const SECRET_RE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*secrets?\.(json|ya?ml|toml|txt)|\.npmrc|\.netrc|\.pypirc|credentials(\.json)?)$/i;
const GIT_FLAGS = ['--oneline', '--stat', '--numstat', '--shortstat', '--name-only', '--name-status', '-p', '--patch', '--follow', '--graph', '--decorate', '--all', '-n', '--max-count', '--since', '--until', '--author', '--grep', '-L', '--cached', '--staged', '-s', '--short', '-b', '-r', '-a', '-v', '--porcelain', '--no-merges', '--first-parent', '--date', '--format', '--pretty', '-w', '--ignore-all-space', '-U', '--unified', '--summary', '--abbrev-commit', '--relative-date', '--reverse', '--merges'];
const MAX_OUT = 40_000;

export function run(cmd, args, { cwd, timeout = 20_000, maxOut = MAX_OUT, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let out = '', err = '', cut = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${cmd} timed out`)); }, timeout);
    child.stdout.on('data', d => { if (out.length < maxOut) out += d; else cut = true; });
    child.stderr.on('data', d => { if (err.length < 4000) err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out: cut ? out.slice(0, maxOut) + '\n… (output truncated)' : out, err }); });
  });
}

export function repoTools(root, { git = true } = {}) {
  const ROOT = nodePath.resolve(root);
  let realRoot = null, hasRg = null;

  const escapes = rel => rel === '..' || rel.startsWith('..' + nodePath.sep) || nodePath.isAbsolute(rel);
  async function inside(p = '.') {
    if (typeof p !== 'string') throw new Error('path must be a string');
    const target = nodePath.resolve(ROOT, p);
    if (escapes(nodePath.relative(ROOT, target))) throw new Error(`path escapes the repository: ${p}`);
    realRoot ??= await fs.realpath(ROOT);
    const real = await fs.realpath(target).catch(() => { throw new Error(`no such path: ${p}`); });
    const rel = nodePath.relative(realRoot, real);
    if (escapes(rel)) throw new Error(`path escapes the repository: ${p}`);
    return { abs: real, rel: rel.split(nodePath.sep).join('/') || '.' };
  }
  const isSecret = rel => SECRET_RE.test(rel);
  const clampInt = (v, lo, hi, d) => Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : d;

  async function list(dirAbs, relBase, depth, acc, limit) {
    let entries;
    try { entries = await fs.readdir(dirAbs, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (acc.length >= limit) return;
      if (e.isSymbolicLink()) continue;
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) { acc.push(`${rel}/ (skipped)`); continue; }
        acc.push(`${rel}/`);
        if (depth > 1) await list(nodePath.join(dirAbs, e.name), rel, depth - 1, acc, limit);
      } else if (e.isFile()) {
        if (isSecret(rel)) { acc.push(`${rel} (withheld)`); continue; }
        const st = await fs.stat(nodePath.join(dirAbs, e.name)).catch(() => null);
        acc.push(st ? `${rel} (${st.size} B)` : rel);
      }
    }
  }

  const tools = [
    {
      name: 'repo_list',
      description: 'List files and directories in the repository, relative to its root, with sizes. Skips node_modules, build output and VCS folders.',
      input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory to list, relative to the repository root. Default: the root.' }, depth: { type: 'integer', description: 'Levels to descend, 1-4. Default 2.' } }, required: [], additionalProperties: false },
      label: i => `SCANNING ${i.path && i.path !== '.' ? i.path : '/'}`,
      async call({ path = '.', depth = 2 } = {}) {
        const { abs, rel } = await inside(path);
        const st = await fs.stat(abs); if (!st.isDirectory()) throw new Error(`${rel} is a file; use repo_read`);
        const acc = [], limit = 400;
        await list(abs, rel === '.' ? '' : rel, clampInt(depth, 1, 4, 2), acc, limit);
        return (acc.length ? acc.join('\n') : '(empty)') + (acc.length >= limit ? '\n… (truncated; list a subdirectory)' : '');
      },
    },
    {
      name: 'repo_read',
      description: 'Read a text file from the repository as numbered lines. Long files come back in windows of 400 lines: pass start and end line numbers to read further.',
      input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to the repository root.' }, start: { type: 'integer', description: '1-based first line. Default 1.' }, end: { type: 'integer', description: 'Last line (inclusive). Default start + 399.' } }, required: ['path'], additionalProperties: false },
      label: i => `READING ${i.path}`,
      async call({ path, start = 1, end } = {}) {
        const { abs, rel } = await inside(path);
        if (isSecret(rel)) throw new Error('the gatekeeper does not reveal secrets');
        const st = await fs.stat(abs);
        if (st.isDirectory()) throw new Error(`${rel} is a directory; use repo_list`);
        if (st.size > 4_000_000) throw new Error(`${rel} is too large (${st.size} bytes)`);
        const buf = await fs.readFile(abs);
        if (buf.subarray(0, 8000).includes(0)) throw new Error(`${rel} is a binary file`);
        const lines = buf.toString('utf8').split(/\r?\n/);
        const s = clampInt(start, 1, lines.length, 1), e = clampInt(end, s, lines.length, Math.min(lines.length, s + 399));
        let out = lines.slice(s - 1, e).map((l, i) => `${s + i}\t${l}`).join('\n');
        if (out.length > MAX_OUT) out = out.slice(0, MAX_OUT) + '\n… (window truncated; ask for fewer lines)';
        return `${rel} (lines ${s}-${e} of ${lines.length})\n${out}`;
      },
    },
    {
      name: 'repo_search',
      description: 'Search the repository for text or a regular expression. Returns matching lines as path:line: text, honouring .gitignore.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Text to find. Case-insensitive unless regex is true.' }, path: { type: 'string', description: 'Limit the search to this directory or file.' }, regex: { type: 'boolean', description: 'Treat query as a regular expression. Default false.' }, max: { type: 'integer', description: 'Maximum matching lines, 1-200. Default 60.' } }, required: ['query'], additionalProperties: false },
      label: i => `SEARCHING ${JSON.stringify(String(i.query ?? '')).slice(0, 48)}`,
      async call({ query, path = '.', regex = false, max = 60 } = {}, signal) {
        if (typeof query !== 'string' || !query.trim()) throw new Error('query is required');
        const { rel } = await inside(path);
        const limit = clampInt(max, 1, 200, 60);
        hasRg ??= await run('rg', ['--version']).then(r => r.code === 0, () => false);
        let lines;
        if (hasRg) {
          const args = ['--no-heading', '--line-number', '--color', 'never', '--max-count', '25', '--max-columns', '240', '--max-filesize', '1M', '-g', '!.git', ...(regex ? ['-S'] : ['-F', '-i']), '-e', query, '--', rel];
          const r = await run('rg', args, { cwd: ROOT, signal });
          if (r.code === 2 && r.err) throw new Error(r.err.trim().split('\n')[0]);
          lines = r.out.split('\n').filter(Boolean);
        } else {
          const re = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          lines = []; const { abs } = await inside(path);
          const walk = async (dir, base) => {
            for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
              if (lines.length >= limit || e.isSymbolicLink()) return;
              const r2 = base ? `${base}/${e.name}` : e.name;
              if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) await walk(nodePath.join(dir, e.name), r2); continue; }
              const st = await fs.stat(nodePath.join(dir, e.name)).catch(() => null); if (!st || st.size > 1_000_000) continue;
              const buf = await fs.readFile(nodePath.join(dir, e.name)); if (buf.subarray(0, 8000).includes(0)) continue;
              buf.toString('utf8').split(/\r?\n/).forEach((l, i) => { if (lines.length < limit && re.test(l)) lines.push(`${r2}:${i + 1}:${l.slice(0, 240)}`); });
            }
          };
          const st = await fs.stat(abs);
          if (st.isDirectory()) await walk(abs, rel === '.' ? '' : rel);
          else (await fs.readFile(abs)).toString('utf8').split(/\r?\n/).forEach((l, i) => { if (lines.length < limit && re.test(l)) lines.push(`${rel}:${i + 1}:${l.slice(0, 240)}`); });
        }
        lines = lines.filter(l => !isSecret(l.split(':')[0]));
        if (!lines.length) return 'no matches';
        return lines.slice(0, limit).join('\n') + (lines.length > limit ? `\n… (${lines.length - limit} more; narrow the search)` : '');
      },
    },
  ];

  if (git) tools.push({
    name: 'repo_git',
    description: 'Run a read-only git command in the repository: log, status, diff, show, blame or branch, with common flags. Example: {"command":"log","args":["--oneline","-n","20"]}.',
    input_schema: { type: 'object', properties: { command: { type: 'string', enum: ['log', 'status', 'diff', 'show', 'blame', 'branch'] }, args: { type: 'array', items: { type: 'string' }, description: 'Flags, refs and paths.' } }, required: ['command'], additionalProperties: false },
    label: i => `GIT ${String(i.command || '').toUpperCase()}`,
    async call({ command, args = [] } = {}, signal) {
      if (!['log', 'status', 'diff', 'show', 'blame', 'branch'].includes(command)) throw new Error('command not allowed');
      if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) throw new Error('args must be strings');
      for (const a of args) {
        if (a.startsWith('-') && !GIT_FLAGS.some(f => a === f || a.startsWith(f + '=') || (/^-[nLU]\d*$/.test(a)))) throw new Error(`flag not allowed: ${a}`);
        if (a.startsWith('--output') || a.includes('\0')) throw new Error(`flag not allowed: ${a}`);
      }
      const r = await run('git', ['-c', 'core.pager=cat', '--no-pager', command, '--no-color', ...args], { cwd: ROOT, signal });
      if (r.code !== 0) throw new Error(r.err.trim() || `git ${command} failed`);
      return r.out.trim() || '(no output)';
    },
  });

  return tools;
}
