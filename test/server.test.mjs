// node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, chmod, rm } from 'node:fs/promises';
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
  const { repoTools } = await import('../server/repo-tools.mjs');
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
  const { createClaudeCodeOracle } = await import('../server/oracle-claude-code.mjs');
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
  const { createApiOracle } = await import('../server/oracle-api.mjs');
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
  const { repoTools } = await import('../server/repo-tools.mjs'); void repoTools;
  const { loadMcp } = await import('../server/mcp.mjs');
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

test('server: health, secret, JSON answer and SSE stream with the mock oracle', async () => {
  const port = 3100 + Math.floor(Math.random() * 800);
  const child = spawn(process.execPath, [join(root, 'server.mjs')], { env: { ...process.env, ORACLE: 'mock', PORT: String(port), GATEKEEPER_SECRET: 's3', REPO: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.on('data', d => { if (/gatekeeper on/.test(d)) resolve(); }); child.on('exit', c => reject(new Error('server exited ' + c))); });
    const base = `http://127.0.0.1:${port}`;
    const health = await (await fetch(base + '/health')).json();
    assert.equal(health.gatekeeper, true); assert.equal(health.oracle, 'mock'); assert.equal(health.secret, true);
    const page = await (await fetch(base + '/')).text();
    assert.match(page, /<title>GATEKEEPER<\/title>/);
    // the page's scripts and styles are served from web/, and nothing outside it is reachable
    for (const src of [...page.matchAll(/(?:src|href)="(web\/[^"]+)"/g)].map(m => m[1])) {
      const f = await fetch(`${base}/${src}`);
      assert.equal(f.status, 200, src);
      assert.match(f.headers.get('content-type'), src.endsWith('.css') ? /text\/css/ : /text\/javascript/, src);
    }
    assert.equal((await fetch(base + '/web/js/nope.js')).status, 404);
    assert.equal((await fetch(base + '/web/../server.mjs')).status, 404);
    assert.equal((await fetch(base + '/web/%2e%2e/server.mjs')).status, 404);
    assert.equal((await fetch(base + '/server.mjs')).status, 404);
    assert.equal((await fetch(base + '/web/js')).status, 404);
    assert.equal((await fetch(base + '/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"question":"x"}' })).status, 401);
    const json = await (await fetch(base + '/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gatekeeper-key': 's3' }, body: JSON.stringify({ question: 'where are the tests?', session: 'j1' }) })).json();
    assert.match(json.answer, /214 tests/); assert.equal(json.oracle, 'mock');
    const r = await fetch(base + '/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-gatekeeper-key': 's3' }, body: JSON.stringify({ question: 'how does auth work?', session: 'e1' }) });
    assert.match(r.headers.get('content-type'), /text\/event-stream/);
    const events = (await r.text()).split('\n\n').map(c => c.split('\n').find(l => l.startsWith('data:'))).filter(Boolean).map(l => JSON.parse(l.slice(5)));
    assert.ok(events.some(e => e.type === 'tool'));
    const done = events.find(e => e.type === 'done');
    assert.match(done.answer, /src\/auth/);
    assert.equal(events.filter(e => e.type === 'delta').map(e => e.text).join(''), done.answer);
  } finally { child.kill(); }
});
