// Gatekeeper bridge: serves the page and answers POST /ask through one of
// three oracles. No build step. Node 20+.
//
//   node server.mjs                       auto-picks an oracle (see below)
//   ORACLE=claude-code REPO=/path node server.mjs
//   ORACLE=api ANTHROPIC_API_KEY=... node server.mjs
//
// Oracles:
//   claude-code  `claude -p` headless in REPO (your Claude Code login, its tools, --mcp-config)
//   api          the Claude API with read-only repo tools and your MCP servers
//   mock         canned answers, no model
// Auto-pick: api when ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_PROFILE is set,
// else claude-code when `claude` is installed, else mock.
//
// Env: PORT (3000) · REPO (cwd) · GATEKEEPER_SECRET (required in x-gatekeeper-key when set)
//      MODEL · EFFORT (api: low|medium|high|xhigh|max, default medium) · MAX_TURNS (12)
//      MCP_CONFIG (path; ./mcp.json if present) · COMPACT=1 (api: server-side compaction)
//      CLAUDE_BIN (claude) · CLAUDE_TOOLS (space/comma list of --allowedTools) · CLAUDE_PERMISSION_MODE
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const exists = p => access(p).then(() => true, () => false);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const cfg = {
  port: Number(env.PORT) || 3000,
  repo: resolve(env.REPO || process.cwd()),
  secret: env.GATEKEEPER_SECRET || '',
  oracle: (env.ORACLE || '').toLowerCase(),
  model: env.MODEL || '', effort: env.EFFORT || '',
  maxTurns: Number(env.MAX_TURNS) || 12,
  mcpConfig: env.MCP_CONFIG || ((await exists(join(process.cwd(), 'mcp.json'))) ? join(process.cwd(), 'mcp.json') : null),
  compact: env.COMPACT === '1',
  claudeBin: env.CLAUDE_BIN || 'claude',
  claudeTools: (env.CLAUDE_TOOLS || '').split(/[,\s]+/).filter(Boolean),
  permissionMode: env.CLAUDE_PERMISSION_MODE || '',
  timeoutMs: Number(env.TIMEOUT_MS) || 300_000,
};

async function createOracle() {
  let kind = cfg.oracle;
  if (!kind || kind === 'auto') {
    if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE) kind = 'api';
    else if (spawnSync(cfg.claudeBin, ['--version'], { stdio: 'ignore' }).status === 0) kind = 'claude-code';
    else kind = 'mock';
    log(`no ORACLE set: using ${kind}`);
  }
  if (kind === 'api') return (await import('./server/oracle-api.mjs')).createApiOracle(cfg, log);
  if (kind === 'claude-code' || kind === 'cli') return (await import('./server/oracle-claude-code.mjs')).createClaudeCodeOracle(cfg);
  if (kind === 'mock') return (await import('./server/oracle-mock.mjs')).createMockOracle();
  throw new Error(`unknown ORACLE "${kind}" (api, claude-code, mock)`);
}
const oracle = await createOracle();
const busy = new Set();

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Accept, x-gatekeeper-key', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...cors }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) throw new Error('too long'); }
  return JSON.parse(raw || '{}');
}

async function handleAsk(req, res) {
  if (cfg.secret && req.headers['x-gatekeeper-key'] !== cfg.secret) return send(res, 401, { error: 'the gate does not know you' });
  let body; try { body = await readJson(req); } catch (e) { return send(res, 400, { error: e.message === 'too long' ? 'too long' : 'bad json' }); }
  const question = String(body.question || '').trim().slice(0, 4000);
  const session = /^[\w.-]{1,64}$/.test(String(body.session || '')) ? String(body.session) : 'default';
  if (!question) return send(res, 400, { error: 'no question' });
  if (busy.has(session)) return send(res, 409, { error: 'the gate is busy with your last question' });
  busy.add(session);
  const sse = /text\/event-stream/.test(req.headers.accept || '');
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  let keepalive;
  const emit = ev => { if (sse && !res.writableEnded) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`); };
  if (sse) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors });
    res.write(`: gatekeeper ${oracle.kind}\n\n`);
    keepalive = setInterval(() => { if (!res.writableEnded) res.write(': keepalive\n\n'); }, 15_000);
  }
  const t0 = Date.now(), id = randomUUID().slice(0, 8);
  log(`[${id}] ask (${oracle.kind}, session ${session}): ${question.slice(0, 80)}${question.length > 80 ? '…' : ''}`);
  try {
    const { answer } = await oracle.ask({ question, session, emit, signal: ac.signal });
    log(`[${id}] answered in ${((Date.now() - t0) / 1000).toFixed(1)}s (${answer.length} chars)`);
    if (sse) { emit({ type: 'done', answer, session, oracle: oracle.kind }); res.end(); }
    else send(res, 200, { answer, session, oracle: oracle.kind });
  } catch (e) {
    const message = ac.signal.aborted ? 'aborted' : String(e?.message || e);
    log(`[${id}] failed: ${message}`);
    if (sse) { emit({ type: 'error', message }); res.end(); }
    else if (!res.headersSent) send(res, 502, { error: message });
  } finally { clearInterval(keepalive); busy.delete(session); }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html'))
      return send(res, 200, await readFile(join(here, 'index.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/health')
      return send(res, 200, { gatekeeper: true, oracle: oracle.kind, model: oracle.model, repo: basename(cfg.repo), secret: !!cfg.secret });
    if (req.method === 'POST' && url.pathname === '/ask') return await handleAsk(req, res);
    send(res, 404, { error: 'not found' });
  } catch (e) { log('error:', e); if (!res.headersSent) send(res, 500, { error: 'internal error' }); else res.end(); }
}).listen(cfg.port, () => {
  log(`gatekeeper on http://localhost:${cfg.port}`);
  log(`oracle: ${oracle.kind}${oracle.describe ? ` — ${oracle.describe()}` : ''}`);
  log(`repo: ${cfg.repo}${cfg.mcpConfig ? `  mcp: ${cfg.mcpConfig}` : ''}${cfg.secret ? '  secret: set' : ''}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await oracle.close?.(); process.exit(0); });
