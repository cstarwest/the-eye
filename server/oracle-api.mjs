// Claude API oracle: a streaming tool-use loop over the Messages API with the
// read-only repository tools, any stdio MCP servers (run here) and any remote
// MCP servers (handed to the API's MCP connector). One conversation per page
// session, append-only; it starts over when it grows too large (or compacts
// server-side with COMPACT=1).
import Anthropic from '@anthropic-ai/sdk';
import { repoTools } from './repo-tools.mjs';
import { loadMcp } from './mcp.mjs';
import { PERSONA } from './persona.mjs';

const MAX_MESSAGES = 80, MAX_CHARS = 600_000;

export async function createApiOracle(cfg, log = () => {}) {
  const client = new Anthropic();   // ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile
  const model = cfg.model || 'claude-opus-5-5', effort = cfg.effort || 'medium';
  const mcp = await loadMcp(cfg.mcpConfig, log);
  const local = [...repoTools(cfg.repo), ...mcp.localTools];
  const byName = new Map(local.map(t => [t.name, t]));
  const toolDefs = local.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema, eager_input_streaming: true }));
  const toolsets = mcp.remoteServers.map(s => ({ type: 'mcp_toolset', mcp_server_name: s.name }));
  const betas = ['server-side-fallback-2026-07-01'];
  if (mcp.remoteServers.length) betas.push('mcp-client-2025-11-20');
  if (cfg.compact) betas.push('compact-2026-01-12');
  const system = [{ type: 'text', text: `${PERSONA}\n\nThe repository is at ${cfg.repo}. Read it with the repo_* tools (and any other tools you are given) before answering; do not guess about code you have not read. A few targeted searches and reads are enough.`, cache_control: { type: 'ephemeral' } }];
  const sessions = new Map();

  async function ask({ question, session, emit, signal }) {
    let state = sessions.get(session);
    if (!state) sessions.set(session, state = { messages: [], chars: 0 });
    if (!cfg.compact && (state.messages.length > MAX_MESSAGES || state.chars > MAX_CHARS)) { state.messages = []; state.chars = 0; emit({ type: 'status', text: 'THE SESSION FORGETS' }); }
    const { messages } = state;
    messages.push({ role: 'user', content: question }); state.chars += question.length;
    let answer = '', turns = 0, jsonRetries = 0;
    try {
      while (true) {
        if (++turns > (cfg.maxTurns || 12)) { emit({ type: 'status', text: 'THE SESSION WANDERS' }); break; }
        const stream = client.beta.messages.stream({
          model, max_tokens: 16000, betas, fallbacks: 'default',
          thinking: { type: 'adaptive' }, output_config: { effort },
          system, tools: [...toolDefs, ...toolsets],
          ...(mcp.remoteServers.length ? { mcp_servers: mcp.remoteServers } : {}),
          ...(cfg.compact ? { context_management: { edits: [{ type: 'compact_20260112' }] } } : {}),
          messages,
        }, { signal });
        stream.on('text', delta => { answer += delta; emit({ type: 'delta', text: delta }); });
        let message;
        try { message = await stream.finalMessage(); jsonRetries = 0; }
        catch (err) {
          if (err instanceof Anthropic.APIError || signal?.aborted || jsonRetries++ >= 2) throw err;
          emit({ type: 'status', text: 'THE SESSION STUTTERS' }); continue;   // a tool input that was not parseable JSON: re-issue the turn
        }
        if (message.content.length) { messages.push({ role: 'assistant', content: message.content }); state.chars += JSON.stringify(message.content).length; }
        for (const b of message.content) if (b.type === 'mcp_tool_use') emit({ type: 'tool', label: `${String(b.server_name || 'MCP').toUpperCase()}: ${b.name}` });
        if (message.stop_reason === 'refusal') { emit({ type: 'status', text: 'THE SESSION DECLINES' }); break; }
        if (message.stop_reason === 'pause_turn') continue;
        const toolUses = message.content.filter(b => b.type === 'tool_use');
        if (!toolUses.length) break;
        if (message.stop_reason === 'max_tokens') throw new Error('the session ran out of breath mid-call');
        const results = [];
        for (const tu of toolUses) {
          const tool = byName.get(tu.name);
          let result;
          if (!tool) result = { is_error: true, content: `unknown tool ${tu.name}` };
          else {
            emit({ type: 'tool', label: safeLabel(tool, tu.input) });
            const bad = validate(tool.input_schema, tu.input);
            if (bad) result = { is_error: true, content: JSON.stringify({ INVALID_JSON: JSON.stringify(tu.input), error: bad }) };
            else try { result = { content: String(await tool.call(tu.input, signal)) }; }
            catch (e) { result = { is_error: true, content: String(e?.message || e) }; }
          }
          results.push({ type: 'tool_result', tool_use_id: tu.id, ...result });
        }
        messages.push({ role: 'user', content: results }); state.chars += JSON.stringify(results).length;
        if (answer && !/\n$/.test(answer)) { answer += '\n\n'; emit({ type: 'delta', text: '\n\n' }); }
      }
    } catch (err) {
      if (messages[messages.length - 1]?.role === 'user' && typeof messages[messages.length - 1].content === 'string') messages.pop();   // the question never got an answer: keep history consistent
      throw friendly(err);
    }
    return { answer: answer.trim() || 'The session said nothing.' };
  }

  return {
    kind: 'api', model,
    describe: () => `${model} (effort ${effort}) with ${toolDefs.length} local tool${toolDefs.length === 1 ? '' : 's'}${toolsets.length ? ` + ${toolsets.length} remote MCP server(s)` : ''}`,
    forget: session => sessions.delete(session),
    ask, close: () => mcp.close(),
  };
}

function safeLabel(tool, input) { try { return String(tool.label ? tool.label(input || {}) : tool.name.toUpperCase()); } catch { return tool.name.toUpperCase(); } }

// Shallow check of a tool input against its JSON schema: required keys and
// primitive property types. With eager input streaming the API no longer
// validates inputs, and the SDK's tolerant parser can hand back a truncated
// object, so anything that fails goes back to Claude as an error result.
function validate(schema, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input is not an object';
  for (const k of schema?.required || []) if (!(k in input)) return `missing ${k}`;
  for (const [k, v] of Object.entries(input)) {
    const p = schema?.properties?.[k]; if (!p || !p.type || v === null || v === undefined) continue;
    const t = Array.isArray(p.type) ? p.type : [p.type];
    const ok = t.some(x => x === 'integer' ? Number.isInteger(v) : x === 'number' ? typeof v === 'number' : x === 'array' ? Array.isArray(v) : x === 'object' ? typeof v === 'object' : x === 'null' ? v === null : typeof v === x);
    if (!ok) return `${k} should be ${t.join('|')}`;
    if (p.enum && !p.enum.includes(v)) return `${k} must be one of ${p.enum.join(', ')}`;
  }
  return null;
}

function friendly(err) {
  if (err instanceof Anthropic.AuthenticationError) return new Error('The gate has no key. Set ANTHROPIC_API_KEY, or run `ant auth login`, and restart the bridge.');
  if (err instanceof Anthropic.PermissionDeniedError) return new Error('The key does not open this gate. Check the model and the account.');
  if (err instanceof Anthropic.RateLimitError) return new Error('The session is overwhelmed. Ask again in a moment.');
  if (err instanceof Anthropic.APIConnectionError) return new Error('The session is out of reach. Check the network.');
  if (err instanceof Anthropic.APIError) return new Error(`The session refused the request (${err.status}): ${err.message}`);
  return err instanceof Error ? err : new Error(String(err));
}
