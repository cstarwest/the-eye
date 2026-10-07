// node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, chmod, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const collect = () => { const events = []; return { events, emit: e => events.push(e), text: () => events.filter(e => e.type === 'delta').map(e => e.text).join(''), labels: () => events.filter(e => e.type === 'tool').map(e => e.label) }; };

async function tempRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'gk-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'main.ts'), 'export const main = () => 42;\n// TODO: refresh token\n');
  await writeFile(join(dir, 'README.md'), '# demo\n');
  await writeFile(join(dir, '.env'), 'SECRET=hunter2\n');
  try { execFileSync('git', ['init', '-q'], { cwd: dir }); execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'first light'], { cwd: dir }); } catch {}
  return dir;
}

test('repo tools: list, read, search, git; paths and secrets are guarded', async () => {
  const { repoTools } = await import('../desktop/repo-tools.mjs');
  const dir = await tempRepo();
  const tools = Object.fromEntries(repoTools(dir).map(t => [t.name, t]));
  assert.match(await tools.repo_list.call({}), /src\//);
  assert.match(await tools.repo_list.call({ path: 'src' }), /main\.ts \(\d+ B\)/);
  assert.match(await tools.repo_list.call({}), /\.env \(withheld\)/);
  assert.match(await tools.repo_read.call({ path: 'src/main.ts' }), /1\texport const main/);
  await assert.rejects(tools.repo_read.call({ path: '../../etc/passwd' }), /escapes/);
  await assert.rejects(tools.repo_read.call({ path: '/etc/passwd' }), /escapes/);
  await assert.rejects(tools.repo_read.call({ path: '.env' }), /secrets/);
  assert.match(await tools.repo_search.call({ query: 'refresh token' }), /src\/main\.ts:2:/);
  assert.equal(await tools.repo_search.call({ query: 'hunter2' }), 'no matches');
  assert.match(await tools.repo_git.call({ command: 'log', args: ['--oneline', '-n', '5'] }), /first light/);
  await assert.rejects(tools.repo_git.call({ command: 'log', args: ['--output=/tmp/x'] }), /not allowed/);
  await assert.rejects(tools.repo_git.call({ command: 'push' }), /not allowed/);
  await rm(dir, { recursive: true, force: true });
});

test('claude-code oracle: streams deltas and tool labels, resumes the session, surfaces failures', async () => {
  const { createClaudeCodeOracle } = await import('../desktop/oracle-claude-code.mjs');
  const bin = join(here, 'fixtures', 'fake-claude.mjs'); await chmod(bin, 0o755);
  const log = join(await mkdtemp(join(tmpdir(), 'gk-')), 'args.log');
  process.env.FAKE_CLAUDE_LOG = log;
  const oracle = createClaudeCodeOracle({ claudeBin: bin, repo: root, maxTurns: 3 });
  const c1 = collect();
  const r1 = await oracle.ask({ question: 'where is the answer?', session: 's1', emit: c1.emit });
  assert.equal(r1.answer, 'The answer is forty-two. It lives in src/main.ts.');
  assert.equal(c1.text(), r1.answer);
  assert.ok(c1.labels().some(l => /READING .*main\.ts/i.test(l)), c1.labels().join(','));
  const c2 = collect();
  const r2 = await oracle.ask({ question: 'and again?', session: 's1', emit: c2.emit });
  assert.match(r2.answer, /still forty-two/);
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  assert.equal(calls.length, 2);
  assert.ok(!calls[0].includes('--resume'));
  assert.ok(calls[1].includes('--resume') && /^sess-/.test(calls[1][calls[1].indexOf('--resume') + 1]));
  assert.ok(calls[0].includes('--append-system-prompt') && calls[0].includes('--allowedTools'));
  await assert.rejects(oracle.ask({ question: 'please FAIL', session: 's2', emit: () => {} }), /simulated failure/);
});

test('api oracle: tool-use loop over the Messages API with streaming, repo tools and MCP', async () => {
  const { startMockAnthropic } = await import('./fixtures/mock-anthropic.mjs');
  const api = await startMockAnthropic();
  process.env.ANTHROPIC_BASE_URL = api.url; process.env.ANTHROPIC_API_KEY = 'test-key';
  const mcpConfig = join(await mkdtemp(join(tmpdir(), 'gk-')), 'mcp.json');
  await writeFile(mcpConfig, JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [join(here, 'fixtures', 'mcp-echo.mjs')] } } }));
  const { createApiOracle } = await import('../desktop/oracle-api.mjs');
  const logs = [];
  const oracle = await createApiOracle({ repo: root, mcpConfig, maxTurns: 4 }, m => logs.push(m));
  assert.ok(logs.some(l => /mcp: echo: 1 tool/.test(l)), logs.join('\n'));
  const c = collect();
  const { answer } = await oracle.ask({ question: 'what is this package called?', session: 'p1', emit: c.emit });
  assert.match(answer, /I read package\.json\. The package is named gatekeeper-eye/);
  assert.equal(c.text().trim(), answer);
  assert.deepEqual(c.labels(), ['READING package.json']);
  assert.equal(api.requests.length, 2);
  const first = api.requests[0];
  assert.equal(first.body.model, 'claude-opus-5-5');
  assert.equal(first.body.fallbacks, 'default');
  assert.equal(first.body.output_config.effort, 'medium');
  assert.deepEqual(first.body.thinking, { type: 'adaptive' });
  assert.match(first.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.ok(first.body.tools.every(t => t.eager_input_streaming === true));
  assert.deepEqual(first.body.tools.map(t => t.name), ['repo_list', 'repo_read', 'repo_search', 'repo_git', 'echo__echo']);
  assert.equal(first.body.system[0].cache_control.type, 'ephemeral');
  const second = api.requests[1].body.messages;
  assert.equal(second.length, 3);
  assert.equal(second[1].role, 'assistant'); assert.equal(second[1].content[0].type, 'tool_use');
  assert.equal(second[2].content[0].type, 'tool_result'); assert.match(second[2].content[0].content, /"name": "gatekeeper-eye"/);
  const echo = oracle; // the MCP tool itself works end to end through the client
  const { repoTools } = await import('../desktop/repo-tools.mjs'); void repoTools;
  const { loadMcp } = await import('../desktop/mcp.mjs');
  const mcp = await loadMcp(mcpConfig);
  assert.equal(await mcp.localTools[0].call({ text: 'hello' }), 'echo: hello');
  await mcp.close(); await echo.close(); await api.close();
});

test('page: every script index.html loads exists, parses, and is loaded in dependency order', async () => {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
  assert.ok(scripts.length >= 10 && styles.length >= 5, `${scripts.length} scripts, ${styles.length} styles`);
  for (const f of [...scripts, ...styles]) await readFile(join(root, f));                       // each one exists
  for (const f of scripts) execFileSync(process.execPath, ['--check', join(root, f)]);          // and parses
  const order = scripts.map(s => s.replace(/^web\/js\//, '').replace(/\.js$/, ''));
  const before = (a, b) => assert.ok(order.indexOf(a) < order.indexOf(b), `${a} must load before ${b}`);
  before('config', 'audio'); before('audio', 'voice'); before('voice', 'eye'); before('eye', 'arena');
  for (const g of ['games/bricks', 'games/shmup', 'games/dodge', 'games/sigil']) before('arena', g);
  before('backend', 'gate'); before('gate', 'setup'); before('gate', 'switch'); before('switch', 'main'); before('setup', 'input');
  assert.equal(order[order.length - 1], 'main');
});

// a folder with `claude` in it (the fake CLI), as an installer would leave it
async function claudeIn(dir) {
  await mkdir(dir, { recursive: true });
  const bin = join(here, 'fixtures', 'fake-claude.mjs'); await chmod(bin, 0o755);
  await symlink(bin, join(dir, 'claude'));
  return join(dir, 'claude');
}
const posix = process.platform !== 'win32';

test('find-claude: PATH, then the usual install locations, CLAUDE_BIN first; nothing found is null', { skip: !posix }, async () => {
  const { findClaude } = await import('../desktop/find-claude.mjs');
  const base = await mkdtemp(join(tmpdir(), 'gk-find-')), home = join(base, 'home'), nodeDir = join(base, 'node');
  await mkdir(home, { recursive: true }); await mkdir(nodeDir); await symlink(process.execPath, join(nodeDir, 'node'));   // node alone, whatever else sits next to it here
  const onPath = await claudeIn(join(base, 'bin'));
  const found = await findClaude({ env: { PATH: `${join(base, 'bin')}:${nodeDir}` }, home });
  assert.equal(found.path, onPath); assert.equal(found.command, onPath); assert.deepEqual(found.args, []);
  assert.equal(found.version, '9.9.9');
  // not on PATH, as when the app is opened from the Dock: the native installer's ~/.local/bin
  const local = await claudeIn(join(home, '.local', 'bin'));
  assert.equal((await findClaude({ env: { PATH: nodeDir }, home })).path, local);
  // CLAUDE_BIN wins, and a wrong one says why
  assert.equal((await findClaude({ env: { PATH: `${join(base, 'bin')}:${nodeDir}`, CLAUDE_BIN: local }, home })).path, local);
  const tried = [];
  assert.equal(await findClaude({ env: { PATH: nodeDir, CLAUDE_BIN: join(base, 'nope') }, home, tried }), null);
  assert.match(tried.join(), /nope: not found/);
  // something called claude that does not answer --version is passed over
  const broken = join(base, 'broken'); await mkdir(broken); await writeFile(join(broken, 'claude'), '#!/bin/sh\nexit 3\n'); await chmod(join(broken, 'claude'), 0o755);
  const tried2 = [];
  assert.equal(await findClaude({ env: { PATH: `${broken}:${nodeDir}` }, home: join(base, 'empty'), tried: tried2 }), null);
  assert.match(tried2.join(), /did not answer --version/);
  await rm(base, { recursive: true, force: true });
});

test('find-claude: a Windows npm shim is followed to the claude.exe it starts, never run through a shell', async () => {
  const { launchFor, knownLocations } = await import('../desktop/find-claude.mjs');
  const npm = await mkdtemp(join(tmpdir(), 'gk-npm-'));
  const exe = join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  await mkdir(dirname(exe), { recursive: true }); await writeFile(exe, ''); await writeFile(join(npm, 'claude.cmd'), '@"%~dp0\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe" %*\r\n');
  assert.deepEqual(launchFor(join(npm, 'claude.cmd'), { platform: 'win32', env: {} }), { command: exe, args: [] });
  assert.deepEqual(launchFor('/usr/local/bin/claude'), { command: '/usr/local/bin/claude', args: [] });
  assert.ok(knownLocations({ platform: 'win32', env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, home: 'C:\\Users\\x' }).some(p => /claude\.cmd$/.test(p)));
  await rm(npm, { recursive: true, force: true });
});

test('find-claude: the login shell\'s PATH and ANTHROPIC_* are adopted, without overriding what is set', { skip: !posix }, async () => {
  const { adoptLoginShellEnv } = await import('../desktop/find-claude.mjs');
  const home = await mkdtemp(join(tmpdir(), 'gk-shell-'));
  await writeFile(join(home, '.bash_profile'), 'export PATH="$PATH:/opt/from-profile/bin"\nexport ANTHROPIC_MODEL_HINT=profile\n');
  const env = { PATH: '/usr/bin:/bin', HOME: home, SHELL: '/bin/bash', ANTHROPIC_API_KEY: 'mine' };
  await adoptLoginShellEnv(env);
  assert.match(env.PATH, /^\/usr\/bin:\/bin:.*\/opt\/from-profile\/bin/);
  assert.equal(env.ANTHROPIC_MODEL_HINT, 'profile');
  assert.equal(env.ANTHROPIC_API_KEY, 'mine');
  await rm(home, { recursive: true, force: true });
});

test('bridge: picks Claude Code when it is found, streams answers, remembers the repository', async () => {
  const { createBridge } = await import('../desktop/bridge.mjs');
  const bin = join(here, 'fixtures', 'fake-claude.mjs'); await chmod(bin, 0o755);
  const find = () => ({ path: bin, command: bin, args: [], version: '9.9.9' });
  const dir = await mkdtemp(join(tmpdir(), 'gk-bridge-')), settingsFile = join(dir, 'settings.json'), repo = await tempRepo(), other = await tempRepo();
  const b = await createBridge({ settingsFile, env: {}, defaultRepo: repo, find });
  let st = b.status();
  assert.equal(st.oracle, 'claude-code'); assert.equal(st.linked, true); assert.equal(st.needsRepo, false);
  assert.equal(st.repoPath, repo); assert.equal(st.claude.version, '9.9.9'); assert.match(st.note, /Claude Code 9\.9\.9/);
  const c = collect();
  assert.equal(await b.ask({ id: 'a1', question: 'where is the answer?', session: 's1' }, c.emit), 'The answer is forty-two. It lives in src/main.ts.');
  assert.ok(c.text().length && c.labels().length);
  await assert.rejects(b.ask({ id: 'a2', question: '  ', session: 's1' }), /no question/);
  await assert.rejects(b.ask({ id: 'a3', question: 'please FAIL', session: 's1' }), /simulated failure/);
  // a second question in the same session waits its turn
  const first = b.ask({ id: 'b1', question: 'one', session: 'busy' });
  await assert.rejects(b.ask({ id: 'b2', question: 'two', session: 'busy' }), /busy/);
  await first;
  // choosing another repository is saved, and survives a restart
  st = await b.setRepo(other);
  assert.equal(st.repoPath, other);
  assert.equal(JSON.parse(await readFile(settingsFile, 'utf8')).repo, other);
  await assert.rejects(b.setRepo(join(other, 'nope')), /not a folder/);
  const again = await createBridge({ settingsFile, env: {}, defaultRepo: repo, find });
  assert.equal(again.status().repoPath, other);
  await b.close(); await again.close();
  for (const d of [dir, repo, other]) await rm(d, { recursive: true, force: true });
});

test('bridge: without a repository it asks for one; without Claude it falls back to the mock; a cancelled question stops', async () => {
  const { createBridge } = await import('../desktop/bridge.mjs');
  const bin = join(here, 'fixtures', 'fake-claude.mjs');
  const found = () => ({ path: bin, command: bin, args: [], version: '9.9.9' });
  const dir = await mkdtemp(join(tmpdir(), 'gk-bridge-'));
  const noRepo = await createBridge({ settingsFile: join(dir, 'a.json'), env: {}, find: found });
  assert.deepEqual([noRepo.status().oracle, noRepo.status().needsRepo, noRepo.status().ready], ['claude-code', true, false]);
  await assert.rejects(noRepo.ask({ id: 'x', question: 'hello?', session: 's' }), /choose a repository/);
  const st = await noRepo.setRepo(root);
  assert.deepEqual([st.needsRepo, st.linked, st.repo], [false, true, 'the-eye']);
  // no Claude Code, no API key: the mock answers, and says why
  const none = () => null;
  const mock = await createBridge({ settingsFile: join(dir, 'b.json'), env: {}, find: none });
  assert.deepEqual([mock.status().oracle, mock.status().linked, mock.status().ready, mock.status().needsRepo], ['mock', false, true, false]);
  assert.match(mock.status().note, /Claude Code was not found.*the mock answers/);
  const c = collect();
  assert.match(await mock.ask({ id: 'm1', question: 'where are the tests?', session: 's' }, c.emit), /214 tests/);
  assert.equal(c.text(), await mock.ask({ id: 'm2', question: 'where are the tests?', session: 't' }));
  const pending = mock.ask({ id: 'm3', question: 'how does auth work?', session: 'u' });
  setTimeout(() => mock.cancel('m3'), 60);
  await assert.rejects(pending, /aborted/);
  // an API key, and no Claude Code: the API oracle
  const api = await createBridge({ settingsFile: join(dir, 'c.json'), env: { ANTHROPIC_API_KEY: 'k' }, defaultRepo: root, find: none });
  assert.equal(api.status().oracle, 'api');
  // ORACLE=claude-code without Claude Code: nothing answers, and the reason is the error
  const forced = await createBridge({ settingsFile: join(dir, 'd.json'), env: { ORACLE: 'claude-code' }, defaultRepo: root, find: none });
  assert.equal(forced.status().ready, false);
  await assert.rejects(forced.ask({ id: 'f', question: 'hello?', session: 's' }), /Claude Code was not found/);
  for (const b of [noRepo, mock, api, forced]) await b.close();
  await rm(dir, { recursive: true, force: true });
});

test('desktop: the window is locked down, and the page reaches nothing but the bridge', async () => {
  const main = await readFile(join(root, 'desktop', 'main.mjs'), 'utf8');
  for (const s of ['contextIsolation: true', 'sandbox: true', 'nodeIntegration: false', "'will-navigate'", "action: 'deny'", 'setPermissionRequestHandler']) assert.ok(main.includes(s), s);
  const html = await readFile(join(root, 'index.html'), 'utf8');
  assert.match(html, /Content-Security-Policy" content="[^"]*connect-src 'none'/);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.main, 'desktop/main.mjs');
  for (const f of pkg.build.files) assert.ok(!/server|test/.test(f), f);
});
