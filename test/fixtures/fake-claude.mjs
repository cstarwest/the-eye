#!/usr/bin/env node
// Stand-in for the `claude` CLI: prints the stream-json shapes the real one
// prints in `-p --output-format stream-json --include-partial-messages` mode.
// Records its argv to FAKE_CLAUDE_LOG when set. A question containing FAIL exits 1; one
// containing HANG starts a child of its own, writes both pids to FAKE_CLAUDE_PIDS and never answers.
import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
let fixture = {};
try { fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fake-claude.config.json'), 'utf8')); } catch {}

const args = process.argv.slice(2);
const repoTools = ['repo_list', 'repo_read', 'repo_search', 'repo_git'].map(n => `mcp__gatekeeper_repo__${n}`);
if (fixture.capture) {
  const mcpIndex = args.indexOf('--mcp-config');
  let mcp; try { if (mcpIndex >= 0) mcp = JSON.parse(readFileSync(args[mcpIndex + 1], 'utf8')); } catch {}
  appendFileSync(fixture.capture, JSON.stringify({ args, cwd: process.cwd(), env: process.env, mcp }) + '\n');
}
if (args[0] === '--version') { process.stdout.write((fixture.version || '9.9.9 (Claude Code)') + '\n'); process.exit(0); }
if (args[0] === '--help') {
  process.stdout.write(fixture.help ?? '--restricted --tools --setting-sources --settings --strict-mcp-config --mcp-config --permission-mode --allowedTools --disable-slash-commands --no-chrome --include-partial-messages');
  process.exit(0);
}
// Simulate automatic repo settings only to establish that the oracle never
// launches this fixture inside the repository. This is not a real CLI test.
const malicious = join(process.cwd(), '.claude', 'settings.json');
if (existsSync(malicious)) { const settings = JSON.parse(readFileSync(malicious, 'utf8')); if (settings.fixtureMarker) writeFileSync(settings.fixtureMarker, 'executed'); }
const q = args.includes('--') ? args[args.indexOf('--') + 1] : args[args.indexOf('-p') + 1] || '';
const resumed = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
if (fixture.log || process.env.FAKE_CLAUDE_LOG) appendFileSync(fixture.log || process.env.FAKE_CLAUDE_LOG, JSON.stringify(args) + '\n');
const session = resumed || 'sess-' + Math.random().toString(36).slice(2, 8);
const out = o => process.stdout.write(JSON.stringify(o) + '\n');

if (/FAIL/.test(q)) { process.stderr.write('simulated failure\n'); process.exit(1); }
// HANG: start a long-lived child of its own (as real tools and MCP servers are), record both pids, never answer
if (/HANG/.test(q)) {
  const { spawn } = await import('node:child_process');
  const kid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  if (fixture.pids || process.env.FAKE_CLAUDE_PIDS) appendFileSync(fixture.pids || process.env.FAKE_CLAUDE_PIDS, JSON.stringify({ claude: process.pid, child: kid.pid }) + '\n');
  out({ type: 'system', subtype: 'init', session_id: 'sess-hang', cwd: process.cwd(), tools: repoTools, mcp_servers: [{ name: 'gatekeeper_repo', status: 'connected' }] });
  setInterval(() => {}, 1000);
} else {
if (!fixture.omitInit) out({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd(), tools: fixture.tools || repoTools, plugins: fixture.plugins || [], mcp_servers: fixture.mcpServers || [{ name: 'gatekeeper_repo', status: 'connected' }] });
out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: fixture.toolCall || 'mcp__gatekeeper_repo__repo_read', input: { path: 'src/main.ts' } }] } });
out({ type: 'system', subtype: 'task_summary', detail: 'Reading main.ts' });
out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'export const main = () => 42;' }] } });
const answer = resumed ? `Still ${q.length} characters of question. The answer is still forty-two.` : 'The answer is forty-two. It lives in src/main.ts.';
out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
for (const part of answer.match(/.{1,9}/g)) out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } } });
out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: answer }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: answer, session_id: session, total_cost_usd: 0 });
}
