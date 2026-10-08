// Claude Code remains a trusted installed program, not an OS sandbox. It runs
// outside the repository, with no built-in host-access tools and only our MCP.
// --restricted preserves normal subscription authentication, unlike --bare.
// Machine-admin managed policy still applies; user/project settings do not.
// Flags verified against https://code.claude.com/docs/en/cli-reference and
// https://code.claude.com/docs/en/headless (2026-10-08).
import { spawnTracked, killTree } from './processes.mjs';
import { createInterface } from 'node:readline';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERSONA } from './persona.mjs';
import { isRepoPath, safeChildEnv, probeProcess, withProbeEnvironment } from './find-claude.mjs';
import { REPO_MCP_NAME, REPO_TOOL_NAMES } from './repo-mcp.mjs';

const REQUIRED_FLAGS = ['--restricted', '--tools', '--setting-sources', '--settings', '--strict-mcp-config',
  '--mcp-config', '--permission-mode', '--allowedTools', '--disable-slash-commands', '--no-chrome',
  '--include-partial-messages'];
const deniedBuiltins = ['Read', 'Edit', 'Write', 'Bash', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'Skill', 'ToolSearch'];
const allowed = REPO_TOOL_NAMES.map(n => `mcp__${REPO_MCP_NAME}__${n}`);
const settings = JSON.stringify({ disableAllHooks: true, enableAllProjectMcpServers: false, enabledPlugins: {},
  permissions: { defaultMode: 'dontAsk', allow: allowed, deny: deniedBuiltins } });

export async function checkClaudeCapabilities(bin, pre, env, repo) {
  return withProbeEnvironment(env, async context => {
    const v = await probeProcess(bin, [...pre, '--version'], context);
    const match = v.out.trim().match(/^(\d+)\.(\d+)\.(\d+) \(Claude Code\)$/);
    const version = match && match.slice(1).map(Number);
    if (v.code !== 0 || !version || version[0] < 2 || (version[0] === 2 && (version[1] < 1 || (version[1] === 1 && version[2] < 248)))) {
      throw new Error('restricted repository mode requires Claude Code 2.1.248 or later; update the installed CLI');
    }
    const help = await probeProcess(bin, [...pre, '--help'], context);
    const missing = REQUIRED_FLAGS.filter(flag => !new RegExp(`(^|[\\s,])${flag}(?=[\\s,=<]|$)`, 'm').test(help.out));
    // Some builds hide supported flags. Reject them rather than infer security
    // behavior from a version string; the resulting compatibility limit is intentional.
    if (help.code !== 0 || missing.length) throw new Error(`installed Claude Code does not advertise required isolation flags: ${missing.join(', ') || '--help failed'}; update the installed CLI`);
  }, { repo });
}

export function createClaudeCodeOracle(cfg) {
  const bin = cfg.claudeBin, pre = cfg.claudeArgs || [], sourceEnv = cfg.env || process.env;
  // Silently dropping a provider/config selection could change the account,
  // destination or billing. These environments need a separately reviewed flow.
  const unsupported = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'ANTHROPIC_PROFILE',
    'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_WORKSPACE_ID'];
  const configured = unsupported.filter(key => sourceEnv[key]);
  if (configured.length) throw new Error(`restricted Claude mode does not support ${configured.join(', ')}; remove these overrides only if you intend to use the default Claude account/provider`);
  if (!bin || !isAbsolute(bin)) throw new Error('claudeBin must be an absolute installed executable; run Claude detection again');
  if (!Array.isArray(pre) || pre.length > 1 || (pre.length && (typeof pre[0] !== 'string' || !isAbsolute(pre[0]) || !/\.[cm]?js$/i.test(pre[0])))) {
    throw new Error('claudeArgs may only name an absolute installed CLI script; extra CLI flags are not allowed');
  }
  if ([bin, ...pre].some(p => isRepoPath(p, cfg.repo))) throw new Error('repository-local Claude executables are not trusted');
  if (cfg.claudeTools?.length) throw new Error('custom claudeTools are disabled; only the built-in restricted repository tools are available');
  if (cfg.permissionMode && cfg.permissionMode !== 'dontAsk') throw new Error('custom permissionMode is disabled; repository mode uses dontAsk');
  if (cfg.mcpConfig) throw new Error('external MCP configuration is disabled in restricted Claude mode; remove mcpConfig or use API mode with explicit per-tool approval');
  for (const p of [sourceEnv.HOME || homedir(), sourceEnv.USERPROFILE, sourceEnv.APPDATA, sourceEnv.LOCALAPPDATA, join(sourceEnv.HOME || sourceEnv.USERPROFILE || homedir(), '.claude'), join(sourceEnv.HOME || sourceEnv.USERPROFILE || homedir(), '.claude.json')].filter(Boolean)) {
    if (!isAbsolute(p) || isRepoPath(p, cfg.repo)) throw new Error('Claude authentication/configuration directories must be absolute and outside the repository');
  }
  const sessions = new Map(), children = new Set();
  let ready, workspace, childEnv, mcpConfig, closed = false;
  const initialize = () => ready ||= (async () => {
    await checkClaudeCapabilities(bin, pre, sourceEnv, cfg.repo);
    if (closed) throw new Error('oracle closed');
    workspace = await mkdtemp(join(tmpdir(), 'gatekeeper-claude-'));
    if (isRepoPath(workspace, cfg.repo)) throw new Error('the private Claude working directory must be outside the repository');
    childEnv = safeChildEnv(sourceEnv, { repo: cfg.repo });
    // The package's own Node/Electron runtime starts the MCP, never a PATH node.
    const mcpEnv = { ELECTRON_RUN_AS_NODE: '1', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '',
      CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_BASE_URL: '', PATH: childEnv.PATH };
    mcpConfig = join(workspace, 'mcp.json');
    await writeFile(mcpConfig, JSON.stringify({ mcpServers: { [REPO_MCP_NAME]: {
      type: 'stdio', command: process.execPath,
      args: [fileURLToPath(new URL('./repo-mcp.mjs', import.meta.url)), await realpath(cfg.repo)], env: mcpEnv,
    } } }), { mode: 0o600 });
  })();
  return {
    kind: 'claude-code', model: cfg.model || 'default',
    describe: () => 'restricted Claude Code; app-owned repository MCP only (not an OS sandbox)',
    forget: session => sessions.delete(session),
    async ask({ question, session, emit = () => {}, signal }) {
      if (signal?.aborted) throw new Error('aborted');
      if (closed) throw new Error('oracle closed');
      await initialize();
      if (closed || signal?.aborted) throw new Error(signal?.aborted ? 'aborted' : 'oracle closed');
      return new Promise((resolve, reject) => {
        const args = [...pre, '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
          '--max-turns', String(cfg.maxTurns || 12), '--append-system-prompt', PERSONA,
          '--restricted', '--tools', '', '--setting-sources', '', '--settings', settings,
          '--disable-slash-commands', '--no-chrome', '--strict-mcp-config', '--mcp-config', mcpConfig,
          '--permission-mode', 'dontAsk', '--allowedTools', ...allowed];
        if (cfg.model) args.push('--model', cfg.model);
        const prior = sessions.get(session);
        if (prior) args.push('--resume', prior);
        // End option parsing before untrusted user text, including leading '-'.
        args.push('--', String(question));
        const child = spawnTracked(bin, args, { cwd: workspace, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
        children.add(child);
        let streamed = '', assistantText = '', resultText = null, isError = false, stderr = '', sawTextBlock = false, settled = false, initialized = false;
        const finish = (err, answer) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); err ? reject(err) : resolve({ answer }); };
        const timer = setTimeout(() => { killTree(child); finish(new Error('the session took too long')); }, cfg.timeoutMs || 300_000);
        const onAbort = () => { killTree(child); finish(new Error('aborted')); };
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
        child.stderr.on('data', d => { if (stderr.length < 4000) stderr += d; });
        child.on('error', e => finish(e.code === 'ENOENT' ? new Error(`cannot find the claude command (${bin}); install Claude Code or set CLAUDE_BIN or "claudeBin" in the settings file`) : e));
        const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
        rl.on('line', line => {
          if (settled) return;
          let obj; try { obj = JSON.parse(line); } catch { return; }
          if (obj.session_id && !sessions.get(session)) sessions.set(session, obj.session_id);
          switch (obj.type) {
            case 'system':
              if (obj.subtype === 'init') {
                // Fail closed if the installed CLI reports a widened tool set.
                // EndConversation is CLI control flow, not a host-access tool.
                if (!Array.isArray(obj.tools) || obj.tools.some(t => !allowed.includes(t) && t !== 'EndConversation')) {
                  killTree(child); return finish(new Error('Claude reported tools outside the restricted repository tool set'));
                }
                if ((obj.plugins !== undefined && (!Array.isArray(obj.plugins) || obj.plugins.length)) || !Array.isArray(obj.mcp_servers) || obj.mcp_servers.some(s => !s || s.name !== REPO_MCP_NAME)) {
                  killTree(child); return finish(new Error('Claude loaded unexpected plugins or MCP servers'));
                }
                if (!allowed.every(t => obj.tools.includes(t)) || !(obj.mcp_servers || []).some(s => s.name === REPO_MCP_NAME && s.status === 'connected')) {
                  killTree(child); return finish(new Error('the restricted repository MCP failed to connect; no repository tools are available'));
                }
                initialized = true;
                if (obj.session_id) sessions.set(session, obj.session_id);
              }
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
                if (b.type === 'tool_use') {
                  if (!allowed.includes(b.name) && b.name !== 'EndConversation') {
                    killTree(child); return finish(new Error('Claude attempted a tool outside the restricted repository tool set'));
                  }
                  emit({ type: 'tool', label: describeTool(b) });
                }
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
          children.delete(child);
          signal?.removeEventListener('abort', onAbort);
          if (settled) return;
          const answer = (streamed.trim() || resultText || assistantText).trim();
          if (isError) return finish(new Error(answer || 'the session reported an error'));
          if (code !== 0) {
            if (/resume|session/i.test(stderr) && prior) sessions.delete(session);   // stale session id: next question starts fresh
            return finish(new Error(stderr.trim().split('\n').pop() || `claude exited with ${code}`));
          }
          if (!initialized) return finish(new Error('Claude did not confirm the restricted repository tool set'));
          finish(null, answer || 'The session said nothing.');
        });
      });
    },
    async close() {
      closed = true; sessions.clear();
      const exits = [...children].map(child => new Promise(resolve => {
        const timer = setTimeout(() => killTree(child, 'SIGKILL'), 1000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
        killTree(child);
      }));
      await Promise.all(exits);
      await ready?.catch(() => {});
      if (workspace) await rm(workspace, { recursive: true, force: true });
    },
  };
}

function describeTool(b) {
  const i = b.input || {}, n = b.name || 'tool';
  if (n === 'mcp__gatekeeper_repo__repo_read' && i.path) return `READING ${short(i.path)}`;
  if (n === 'mcp__gatekeeper_repo__repo_search' && i.query) return `SEARCHING ${JSON.stringify(String(i.query)).slice(0, 40)}`;
  if (n === 'mcp__gatekeeper_repo__repo_list') return `SCANNING ${i.path || '/'}`;
  if (n === 'mcp__gatekeeper_repo__repo_git') return `GIT ${String(i.command || '').toUpperCase()}`;
  if (n.startsWith('mcp__')) return n.replace(/^mcp__/, '').replace(/__/g, ': ').toUpperCase();
  return n.toUpperCase();
}
const short = p => String(p).split(/[\\/]/).slice(-3).join('/');
