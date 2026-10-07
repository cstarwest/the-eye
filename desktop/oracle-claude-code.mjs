// Claude Code oracle: runs `claude -p` headlessly in the repository, streaming
// its stream-json output. Each page session maps to a Claude Code session that
// is resumed on the next question, so the gatekeeper remembers the conversation.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { PERSONA } from './persona.mjs';

const DEFAULT_TOOLS = ['Read', 'Glob', 'Grep', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git show:*)', 'Bash(git blame:*)'];

export function createClaudeCodeOracle(cfg) {
  const bin = cfg.claudeBin || 'claude', pre = cfg.claudeArgs || [];   // pre: e.g. cli.js when claude runs under node
  const tools = cfg.claudeTools?.length ? cfg.claudeTools : DEFAULT_TOOLS;
  const sessions = new Map();   // page session -> claude session id
  return {
    kind: 'claude-code', model: cfg.model || 'default',
    describe: () => `claude -p in ${cfg.repo} (tools: ${tools.join(' ')})`,
    forget: session => sessions.delete(session),
    ask({ question, session, emit, signal }) {
      return new Promise((resolve, reject) => {
        const args = [...pre, '-p', question, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
          '--max-turns', String(cfg.maxTurns || 12), '--append-system-prompt', PERSONA, '--allowedTools', ...tools];
        if (cfg.model) args.push('--model', cfg.model);
        if (cfg.mcpConfig) args.push('--mcp-config', cfg.mcpConfig);
        if (cfg.permissionMode) args.push('--permission-mode', cfg.permissionMode);
        const prior = sessions.get(session);
        if (prior) args.push('--resume', prior);
        const env = { ...process.env }; delete env.CLAUDECODE;   // allow launching from inside another Claude Code session
        const child = spawn(bin, args, { cwd: cfg.repo, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let streamed = '', assistantText = '', resultText = null, isError = false, stderr = '', sawTextBlock = false, settled = false;
        const finish = (err, answer) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve({ answer }); };
        const timer = setTimeout(() => { child.kill(); finish(new Error('the session took too long')); }, cfg.timeoutMs || 300_000);
        const onAbort = () => { child.kill(); finish(new Error('aborted')); };
        signal?.addEventListener('abort', onAbort, { once: true });
        child.stderr.on('data', d => { if (stderr.length < 4000) stderr += d; });
        child.on('error', e => finish(e.code === 'ENOENT' ? new Error(`cannot find the claude command (${bin}); install Claude Code or set CLAUDE_BIN or "claudeBin" in the settings file`) : e));
        const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
        rl.on('line', line => {
          let obj; try { obj = JSON.parse(line); } catch { return; }
          if (obj.session_id && !sessions.get(session)) sessions.set(session, obj.session_id);
          switch (obj.type) {
            case 'system':
              if (obj.subtype === 'init' && obj.session_id) sessions.set(session, obj.session_id);
              else if (obj.subtype === 'task_summary' && obj.detail) emit({ type: 'tool', label: String(obj.detail).toUpperCase() });
              break;
            case 'stream_event': {
              const ev = obj.event || {};
              if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') { if (sawTextBlock && streamed && !/\s$/.test(streamed)) { streamed += '\n\n'; emit({ type: 'delta', text: '\n\n' }); } sawTextBlock = true; }
              if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) { streamed += ev.delta.text; emit({ type: 'delta', text: ev.delta.text }); }
              break;
            }
            case 'assistant':
              for (const b of obj.message?.content || []) {
                if (b.type === 'tool_use') emit({ type: 'tool', label: describeTool(b) });
                else if (b.type === 'text' && b.text) assistantText += (assistantText ? '\n\n' : '') + b.text;
              }
              break;
            case 'result':
              if (typeof obj.result === 'string') resultText = obj.result;
              if (obj.is_error) isError = true;
              if (obj.session_id) sessions.set(session, obj.session_id);
              break;
            default:
              if (typeof obj.result === 'string') { resultText = obj.result; if (obj.is_error) isError = true; }
          }
        });
        child.on('close', code => {
          signal?.removeEventListener('abort', onAbort);
          if (settled) return;
          const answer = (streamed.trim() || resultText || assistantText).trim();
          if (isError) return finish(new Error(answer || 'the session reported an error'));
          if (code !== 0 && !answer) {
            if (/resume|session/i.test(stderr) && prior) sessions.delete(session);   // stale session id: next question starts fresh
            return finish(new Error(stderr.trim().split('\n').pop() || `claude exited with ${code}`));
          }
          finish(null, answer || 'The session said nothing.');
        });
      });
    },
  };
}

function describeTool(b) {
  const i = b.input || {}, n = b.name || 'tool';
  if (n === 'Read' && i.file_path) return `READING ${short(i.file_path)}`;
  if (n === 'Grep' && i.pattern) return `SEARCHING ${JSON.stringify(String(i.pattern)).slice(0, 40)}`;
  if (n === 'Glob' && i.pattern) return `SCANNING ${i.pattern}`;
  if (n === 'Bash' && i.command) return `RUNNING ${String(i.command).slice(0, 40).toUpperCase()}`;
  if (n.startsWith('mcp__')) return n.replace(/^mcp__/, '').replace(/__/g, ': ').toUpperCase();
  return n.toUpperCase();
}
const short = p => String(p).split(/[\\/]/).slice(-3).join('/');
