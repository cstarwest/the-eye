// Synthetic repositories only: these sentinels are deliberately fake secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, rm, symlink, chmod, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { execFileSync } from 'node:child_process';
import { repoTools } from '../desktop/repo-tools.mjs';

const posix = process.platform !== 'win32';
const SECRET = 'GK_SYNTHETIC_SECRET_629e';
const IGNORED = 'GK_SYNTHETIC_IGNORED_763a';
const env = () => ({ ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: posix ? '/dev/null' : 'NUL', GIT_CONFIG_SYSTEM: posix ? '/dev/null' : 'NUL' });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: env(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const table = root => Object.fromEntries(repoTools(root).map(t => [t.name, t]));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'gk-security-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules'));
  await mkdir(join(root, 'dist'));
  await mkdir(join(root, 'credentials'));
  await writeFile(join(root, '.gitignore'), 'ignored.txt\nignored-dir/\nignored-link\n');
  await writeFile(join(root, '.env'), SECRET + '\n');
  await writeFile(join(root, 'src', '.env.production'), SECRET + '\n');
  await writeFile(join(root, 'src', 'client.key'), SECRET + '\n');
  await writeFile(join(root, 'credentials', 'plain.txt'), SECRET + '\n');
  await writeFile(join(root, 'ignored.txt'), IGNORED + '\n');
  await mkdir(join(root, 'ignored-dir'));
  await writeFile(join(root, 'ignored-dir', 'plain.txt'), IGNORED + '\n');
  await writeFile(join(root, 'node_modules', 'plain.txt'), IGNORED + '\n');
  await writeFile(join(root, 'dist', 'plain.txt'), IGNORED + '\n');
  await writeFile(join(root, 'src', 'safe.txt'), 'public Needle\nsecond public line\n');
  return { root, tools: table(root) };
}

async function contentPolicy(tools) {
  for (const path of ['.env', 'src/.env.production', 'src/client.key', 'credentials/plain.txt', 'ignored.txt', 'ignored-dir/plain.txt', 'node_modules/plain.txt', 'dist/plain.txt', '.git/config']) {
    await assert.rejects(tools.repo_read.call({ path }), /secrets|excluded/, `read ${path}`);
    await assert.rejects(tools.repo_search.call({ path, query: SECRET }), /secrets|excluded/, `search ${path}`);
  }
  for (const query of [SECRET, IGNORED]) assert.equal(await tools.repo_search.call({ query }), 'no matches');
  assert.match(await tools.repo_search.call({ path: 'src/safe.txt', query: 'needle' }), /^src\/safe\.txt:1:public Needle$/);
  assert.match(await tools.repo_search.call({ query: 'second public' }), /src\/safe\.txt:2:/);
  assert.match(await tools.repo_read.call({ path: 'src/safe.txt' }), /1\tpublic Needle/);
  assert.match(await tools.repo_list.call({}), /\.env \(withheld\)/);
  assert.doesNotMatch(await tools.repo_list.call({ depth: 4 }), /credentials\/plain|node_modules\/plain|ignored-dir\/plain/);
}

test('repo security: explicit files and recursive search share read/ignore/secret rules', async t => {
  const { tools } = await fixture(t);
  await contentPolicy(tools);
  for (const path of ['.GIT/config', '.env::$DATA', 'src/safe.txt.', 'src/safe.txt ', 'src/no\nfile', 'src/a:b']) {
    await assert.rejects(tools.repo_read.call({ path }), /excluded|unsupported|ambiguous/);
    await assert.rejects(tools.repo_search.call({ path, query: SECRET }), /excluded|unsupported|ambiguous/);
  }
});

test('repo security: colon/newline filenames cannot confuse secret filtering', { skip: !posix }, async t => {
  const { root, tools } = await fixture(t);
  for (const name of ['ordinary:client.key', 'ordinary\nclient.key', '.env.production\ntext', '.env:stream']) {
    await writeFile(join(root, name), SECRET + '\n');
    await assert.rejects(tools.repo_read.call({ path: name }), /unsupported|ambiguous/);
    await assert.rejects(tools.repo_search.call({ path: name, query: SECRET }), /unsupported|ambiguous/);
  }
  assert.equal(await tools.repo_search.call({ query: SECRET }), 'no matches');
});

test('repo security: symlink aliases check both requested and resolved paths', { skip: !posix }, async t => {
  const { root, tools } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'gk-security-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'outside.txt'), SECRET);
  await symlink('.env', join(root, 'friendly.txt'));
  await symlink('ignored.txt', join(root, 'friendly-ignored.txt'));
  await symlink('src/safe.txt', join(root, 'ignored-link'));
  await symlink('src/safe.txt', join(root, 'alias.key'));
  await symlink(join(outside, 'outside.txt'), join(root, 'escape.txt'));
  for (const path of ['friendly.txt', 'friendly-ignored.txt', 'ignored-link', 'alias.key', 'escape.txt']) {
    await assert.rejects(tools.repo_read.call({ path }), /secrets|excluded|escapes/);
    await assert.rejects(tools.repo_search.call({ path, query: SECRET }), /secrets|excluded|escapes/);
  }
  assert.equal(await tools.repo_search.call({ query: SECRET }), 'no matches');
});

test('repo security: fallback search preserves the same policy and rejects synchronous regex', { skip: !posix }, async t => {
  const { root } = await fixture(t);
  const gitBinary = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const bin = await mkdtemp(join(tmpdir(), 'gk-security-bin-'));
  t.after(() => rm(bin, { recursive: true, force: true }));
  await symlink(gitBinary, join(bin, 'git'));
  const saved = process.env.PATH;
  process.env.PATH = bin;
  try {
    const tools = table(root);
    await contentPolicy(tools);
    await assert.rejects(tools.repo_search.call({ query: '(a+)+$', regex: true }), /requires ripgrep/);
  } finally { process.env.PATH = saved; }
});

test('repo security: missing Git fails closed when ignore rules cannot be evaluated', { skip: !posix }, async t => {
  const { root } = await fixture(t);
  const saved = process.env.PATH;
  process.env.PATH = '';
  try {
    const tools = table(root);
    await assert.rejects(tools.repo_read.call({ path: 'ignored.txt' }), /Git is required/);
    await assert.rejects(tools.repo_search.call({ query: IGNORED }), /Git is required/);
  } finally { process.env.PATH = saved; }
});

test('repo security: Git supports bounded metadata, rejects object content and branch writes', async t => {
  const { root, tools } = await fixture(t);
  git(root, 'add', '-f', '.env', 'src/safe.txt');
  git(root, '-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-q', '-m', 'synthetic initial metadata');
  await writeFile(join(root, '.env'), SECRET + '_STAGED\n');
  await writeFile(join(root, 'src/safe.txt'), 'public staged change\n');
  git(root, 'add', '.env', 'src/safe.txt');
  const before = git(root, 'for-each-ref', '--format=%(refname) %(objectname)');
  const rejected = [
    ['show', [':.env']], ['show', ['HEAD:.env']], ['show', ['HEAD']], ['blame', ['.env']],
    ['diff', ['--cached', '-p']], ['diff', ['--staged', '--patch']], ['diff', ['--stat']],
    ['log', ['-p']], ['log', ['--format=%B']], ['log', ['-L', '1,2:.env']], ['log', ['HEAD:.env']],
    ['branch', ['created-by-tool']], ['branch', ['-b', 'created-by-tool']], ['branch', ['--delete', 'main']],
    ['status', ['--output=/tmp/forbidden']], ['log', ['-n', '--all']], ['log', ['-n', '999']], ['push', []],
  ];
  for (const [command, args] of rejected) await assert.rejects(tools.repo_git.call({ command, args }), /not allowed/, `${command} ${args}`);
  assert.equal(git(root, 'for-each-ref', '--format=%(refname) %(objectname)'), before);
  assert.match(await tools.repo_git.call({ command: 'log', args: ['--oneline', '-n', '5'] }), /synthetic initial metadata/);
  assert.match(await tools.repo_git.call({ command: 'branch' }), /\S/);
  const diff = await tools.repo_git.call({ command: 'diff', args: ['--cached'] });
  assert.match(diff, /src\/safe\.txt/);
  for (const command of ['log', 'status', 'diff', 'branch']) {
    const output = await tools.repo_git.call({ command, args: command === 'diff' ? ['--staged'] : [] });
    assert.doesNotMatch(output, new RegExp(SECRET));
    assert.doesNotMatch(output, /public staged change/);
  }
});

test('repo security: Git helpers/config redirection and repository PATH executables stay inert', { skip: !posix }, async t => {
  const { root, tools } = await fixture(t);
  git(root, 'add', 'src/safe.txt');
  git(root, '-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-q', '-m', 'synthetic helper metadata');
  const outside = await mkdtemp(join(tmpdir(), 'gk-security-helper-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const marker = join(outside, 'executed'), helper = join(outside, 'helper.mjs');
  await writeFile(helper, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'helper ran');\n`);
  const command = `${process.execPath} ${helper}`;
  git(root, 'config', 'core.fsmonitor', command);
  git(root, 'config', 'diff.external', command);
  git(root, 'config', 'diff.synthetic.textconv', command);
  git(root, 'config', 'core.pager', command);
  git(root, 'config', 'log.showSignature', 'true');
  git(root, 'config', 'core.worktree', outside);
  await writeFile(join(root, '.gitattributes'), '*.txt diff=synthetic\n');
  await writeFile(join(root, 'src/safe.txt'), 'public edited\n');
  await writeFile(join(root, 'git'), `#!/bin/sh\nprintf ran > ${JSON.stringify(marker)}\n`);
  await chmod(join(root, 'git'), 0o755);
  const saved = Object.fromEntries(['PATH', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_EXTERNAL_DIFF', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'RIPGREP_CONFIG_PATH'].map(k => [k, process.env[k]]));
  const rgConfig = join(outside, 'rg-config');
  await writeFile(rgConfig, `--pre=${command}\n`);
  Object.assign(process.env, { PATH: [root, '.', saved.PATH].join(delimiter), GIT_DIR: outside, GIT_WORK_TREE: outside, GIT_EXTERNAL_DIFF: command, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: command, RIPGREP_CONFIG_PATH: rgConfig });
  try {
    const fresh = table(root);
    assert.match(await fresh.repo_git.call({ command: 'log' }), /synthetic helper metadata/);
    assert.match(await fresh.repo_git.call({ command: 'status' }), /src\/safe\.txt/);
    assert.match(await fresh.repo_git.call({ command: 'diff' }), /src\/safe\.txt/);
    assert.match(await fresh.repo_search.call({ query: 'public edited' }), /src\/safe\.txt:1:/);
    await assert.rejects(access(marker), { code: 'ENOENT' });
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  // None of the metadata operations refreshed the index or changed a branch.
  assert.match(await tools.repo_git.call({ command: 'branch' }), /\S/);
});

test('repo security: same-size worktree changes cannot execute clean or process filters', { skip: !posix }, async t => {
  const { root, tools } = await fixture(t);
  await writeFile(join(root, 'filtered.txt'), 'before\n');
  git(root, 'add', 'filtered.txt');
  git(root, '-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-q', '-m', 'synthetic filter metadata');
  const marker = join(root, 'FILTER_RAN'), helper = join(root, 'filter-helper.mjs');
  await writeFile(helper, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'filter ran');\n`);
  const command = `${process.execPath} ${helper}`;
  await writeFile(join(root, 'filtered.txt'), 'after!\n'); // Same size makes Git inspect content.
  await writeFile(join(root, '.gitattributes'), 'filtered.txt filter=synthetic\n');
  for (const key of ['clean', 'process']) {
    git(root, 'config', `filter.synthetic.${key}`, command);
    git(root, 'config', 'filter.synthetic.required', 'true');
    assert.match(await tools.repo_git.call({ command: 'status' }), /filtered\.txt/);
    assert.match(await tools.repo_git.call({ command: 'diff' }), /filtered\.txt/);
    await assert.rejects(access(marker), { code: 'ENOENT' });
  }
});

test('repo security: Git does not discover an ancestor repository outside the selected root', async t => {
  const { root } = await fixture(t);
  git(root, '-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'outside selected root');
  const selected = join(root, 'src'), tools = table(selected);
  await assert.rejects(tools.repo_git.call({ command: 'log' }), /internal \.git directory|git log failed/);
  assert.match(await tools.repo_read.call({ path: 'safe.txt' }), /public Needle/);
});

test('repo security: external Git directories, object stores, and metadata symlinks are rejected', { skip: !posix }, async t => {
  const { root: external } = await fixture(t);
  git(external, '-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'SYNTHETIC_OUTSIDE_HISTORY');
  for (const kind of ['gitfile', 'gitdir-symlink', 'commondir', 'alternates', 'objects-symlink']) {
    const selected = await mkdtemp(join(tmpdir(), 'gk-security-selected-'));
    t.after(() => rm(selected, { recursive: true, force: true }));
    if (kind === 'gitfile') await writeFile(join(selected, '.git'), `gitdir: ${join(external, '.git')}\n`);
    else if (kind === 'gitdir-symlink') await symlink(join(external, '.git'), join(selected, '.git'), 'dir');
    else {
      git(selected, 'init', '-q');
      if (kind === 'commondir') await writeFile(join(selected, '.git', 'commondir'), join(external, '.git'));
      if (kind === 'alternates') await writeFile(join(selected, '.git', 'objects', 'info', 'alternates'), join(external, '.git', 'objects'));
      if (kind === 'objects-symlink') {
        await rm(join(selected, '.git', 'objects'), { recursive: true });
        await symlink(join(external, '.git', 'objects'), join(selected, '.git', 'objects'), 'dir');
      }
    }
    await assert.rejects(table(selected).repo_git.call({ command: 'log' }), /not supported/, kind);
  }
});


test('repo security: bare repositories do not bypass Git layout validation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gk-security-bare-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '--bare');
  const tools = table(root);
  await assert.rejects(tools.repo_git.call({ command: 'log' }), /bare repositories are not supported/);
  await assert.rejects(tools.repo_read.call({ path: 'config' }), /bare repositories are not supported/);
});
