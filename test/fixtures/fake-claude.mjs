#!/usr/bin/env node
// Stand-in for the `claude` CLI: prints the stream-json shapes the real one
// prints in `-p --output-format stream-json --include-partial-messages` mode.
// Records its argv to FAKE_CLAUDE_LOG when set. A question containing FAIL exits 1.
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('9.9.9 (Claude Code)\n'); process.exit(0); }
const q = args[args.indexOf('-p') + 1] || '';
const resumed = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(args) + '\n');
const session = resumed || 'sess-' + Math.random().toString(36).slice(2, 8);
const out = o => process.stdout.write(JSON.stringify(o) + '\n');

if (/FAIL/.test(q)) { process.stderr.write('simulated failure\n'); process.exit(1); }
out({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd() });
out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: process.cwd() + '/src/main.ts' } }] } });
out({ type: 'system', subtype: 'task_summary', detail: 'Reading main.ts' });
out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'export const main = () => 42;' }] } });
const answer = resumed ? `Still ${q.length} characters of question. The answer is still forty-two.` : 'The answer is forty-two. It lives in src/main.ts.';
out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
for (const part of answer.match(/.{1,9}/g)) out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } } });
out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: answer }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: answer, session_id: session, total_cost_usd: 0 });
