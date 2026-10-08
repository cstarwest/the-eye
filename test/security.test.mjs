import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeError, trustedSender } from '../desktop/security.mjs';
import { loadMcp } from '../desktop/mcp.mjs';

test('runtime refuses root, sandbox bypasses and unsupported Node before starting', () => {
  const safe = { node: '22.12.0', uid: 1000, argv: [], env: {} };
  assert.equal(runtimeError(safe), null);
  assert.match(runtimeError({ ...safe, uid: 0 }), /root/);
  for (const node of ['20.19.0', '22.11.0']) assert.match(runtimeError({ ...safe, node }), /22.12/);
  for (const arg of ['--no-sandbox', '--no-sandbox=true', '--disable-setuid-sandbox', '--disable-gpu-sandbox', '--disable-seccomp-filter-sandbox', '--disable-namespace-sandbox'])
    assert.match(runtimeError({ ...safe, argv: [arg] }), /sandbox/);
  assert.match(runtimeError({ ...safe, env: { ELECTRON_DISABLE_SANDBOX: '1' } }), /sandbox/);
});

test('IPC accepts only the exact live window main frame and expected local document', () => {
  const page = 'file:///app/index.html', frame = { url: page };
  const sender = { mainFrame: frame }, window = { isDestroyed: () => false, webContents: sender };
  assert.equal(trustedSender({ sender, senderFrame: frame }, window, page), true);
  assert.equal(trustedSender({ sender: {}, senderFrame: frame }, window, page), false);
  assert.equal(trustedSender({ sender, senderFrame: { url: page } }, window, page), false);
  frame.url = 'https://attacker.invalid/';
  assert.equal(trustedSender({ sender, senderFrame: frame }, window, page), false);
  assert.equal(trustedSender({ sender, senderFrame: frame }, null, page), false);
});

test('MCP is disabled before connection without explicit exact tool grants', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gk-mcp-policy-'));
  const file = join(dir, 'mcp.json');
  try {
    const logs = [];
    await writeFile(file, JSON.stringify({ mcpServers: {
      missing: { command: '/does/not/exist' },
      wildcard: { command: '/does/not/exist', allowedTools: ['*'] },
      remote: { url: 'https://example.invalid/mcp' },
    } }));
    const denied = await loadMcp(file, line => logs.push(line));
    assert.deepEqual(denied.localTools, []); assert.deepEqual(denied.remoteServers, []);
    assert.equal(logs.filter(line => /disabled/.test(line)).length, 3);
    const fixture = fileURLToPath(new URL('./fixtures/mcp-echo.mjs', import.meta.url));
    await writeFile(file, JSON.stringify({ mcpServers: {
      echo: { command: process.execPath, args: [fixture], allowedTools: ['echo'] },
      hidden: { command: process.execPath, args: [fixture], allowedTools: ['another_tool'] },
      remote: { url: 'https://example.invalid/mcp', allowedTools: ['lookup'] },
    } }));
    const granted = await loadMcp(file);
    try {
      assert.deepEqual(granted.localTools.map(t => t.name), ['echo__echo']);
      assert.equal(await granted.localTools[0].call({ text: 'hello' }), 'echo: hello');
      assert.deepEqual(granted.remoteToolsets, [{ type: 'mcp_toolset', mcp_server_name: 'remote', default_config: { enabled: false }, configs: { lookup: { enabled: true } } }]);
      assert.equal(granted.remoteServers.length, 1);
    } finally { await granted.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('API never forwards secret search or Git blob/staged contents from synthetic repo', async () => {
  const { startMockAnthropic } = await import('./fixtures/mock-anthropic.mjs');
  const { createApiOracle } = await import('../desktop/oracle-api.mjs');
  const { execFileSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'gk-api-boundary-'));
  const saved = { url: process.env.ANTHROPIC_BASE_URL, key: process.env.ANTHROPIC_API_KEY };
  const marker = 'SYNTHETIC_PRIVATE_CANARY_73B19';
  try {
    await writeFile(join(dir, '.env'), `TEST_ONLY=${marker}\n`);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '.env'], { cwd: dir });
    for (const tool of [
      { name: 'repo_search', input: { path: '.env', query: 'TEST_ONLY' } },
      { name: 'repo_git', input: { command: 'show', args: [':.env'] } },
      { name: 'repo_git', input: { command: 'diff', args: ['--cached'] } },
    ]) {
      const api = await startMockAnthropic({ tool });
      process.env.ANTHROPIC_BASE_URL = api.url; process.env.ANTHROPIC_API_KEY = 'synthetic-test-key';
      let oracle;
      try {
        oracle = await createApiOracle({ repo: dir, maxTurns: 3 });
        await oracle.ask({ question: 'Inspect this fixture.', session: 'policy', emit: () => {} });
        assert.equal(api.requests.length, 2);
        assert.ok(!JSON.stringify(api.requests).includes(marker), 'secret content reached provider request');
      } finally { await oracle?.close(); await api.close(); }
    }
  } finally {
    for (const [key, value] of [['ANTHROPIC_BASE_URL', saved.url], ['ANTHROPIC_API_KEY', saved.key]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
