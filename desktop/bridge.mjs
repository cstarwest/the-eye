// The bridge, inside the desktop app: finds Claude Code, picks an oracle, keeps
// the chosen repository, and answers the window's questions. Plain Node, so the
// tests drive it without Electron; desktop/main.mjs wires it to the window.
//
// Oracle, unless ORACLE= or "oracle" in the settings file says otherwise:
//   claude-code  when the claude CLI is found (see find-claude.mjs)
//   api          else when ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_PROFILE is set
//   mock         else: canned answers, so the eye and its games still work
//
// Settings file (JSON, all optional): repo, oracle, model, effort, maxTurns,
// mcpConfig, claudeBin, claudeTools, permissionMode, timeoutMs, compact.
// Environment variables of the same meaning win over it for that launch:
// REPO, ORACLE, MODEL, EFFORT, MAX_TURNS, MCP_CONFIG, CLAUDE_BIN, CLAUDE_TOOLS,
// CLAUDE_PERMISSION_MODE, TIMEOUT_MS, COMPACT=1.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { findClaude as defaultFind } from './find-claude.mjs';

const isDir = async p => { try { return (await stat(p)).isDirectory(); } catch { return false; } };
const list = v => Array.isArray(v) ? v.map(String) : String(v || '').split(/[,\s]+/).filter(Boolean);

export async function createBridge({ settingsFile, env = process.env, repo: launchRepo = null, defaultRepo = null, mcpFallback = null, log = () => {}, find = defaultFind } = {}) {
  let settings = {};
  try { settings = JSON.parse(await readFile(settingsFile, 'utf8')) || {}; } catch {}
  const save = async () => { if (!settingsFile) return; await mkdir(dirname(settingsFile), { recursive: true }); await writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n'); };

  let repo = null;
  for (const c of [launchRepo, env.REPO, settings.repo, defaultRepo]) if (c && await isDir(c)) { repo = resolve(c); break; }
  if (launchRepo && repo === resolve(launchRepo) && settings.repo !== repo) { settings.repo = repo; await save(); }

  let oracle = null, kind = null, claude = null, note = '';
  const running = new Map();   // ask id -> { ac, session }

  const cfg = () => ({
    repo, env,
    model: env.MODEL || settings.model || '',
    effort: env.EFFORT || settings.effort || '',
    maxTurns: Number(env.MAX_TURNS || settings.maxTurns) || 12,
    mcpConfig: env.MCP_CONFIG || settings.mcpConfig || (mcpFallback && existsSync(mcpFallback) ? mcpFallback : null),
    compact: env.COMPACT === '1' || settings.compact === true,
    claudeBin: claude?.command, claudeArgs: claude?.args || [],
    claudeTools: list(env.CLAUDE_TOOLS || settings.claudeTools),
    permissionMode: env.CLAUDE_PERMISSION_MODE || settings.permissionMode || '',
    timeoutMs: Number(env.TIMEOUT_MS || settings.timeoutMs) || 300_000,
  });

  async function setup() {
    cancelAll();
    await oracle?.close?.(); oracle = null; note = '';
    const tried = [];
    claude = await find({ env, bin: env.CLAUDE_BIN || settings.claudeBin, tried, repo });
    const want = String(env.ORACLE || settings.oracle || 'auto').toLowerCase();
    kind = want === 'cli' ? 'claude-code' : want !== 'auto' ? want
      : claude ? 'claude-code'
      : env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE ? 'api' : 'mock';
    if (!['claude-code', 'api', 'mock'].includes(kind)) { note = `unknown oracle "${kind}" (claude-code, api, mock)`; return status(); }
    if (kind === 'claude-code' && !claude) { note = `Claude Code was not found${tried.length ? ` (${tried.join('; ')})` : ''}`; return status(); }
    if (kind !== 'mock' && !repo) { note = 'choose a repository for the gatekeeper to read'; return status(); }
    try {
      const c = cfg();
      if (kind === 'claude-code') oracle = (await import('./oracle-claude-code.mjs')).createClaudeCodeOracle(c);
      else if (kind === 'api') oracle = await (await import('./oracle-api.mjs')).createApiOracle(c, log);
      else oracle = (await import('./oracle-mock.mjs')).createMockOracle();
    } catch (e) { oracle = null; note = `the ${kind} oracle did not start: ${e?.message || e}`; return status(); }
    note = kind === 'claude-code' ? `Claude Code ${claude.version} at ${claude.path}`
      : kind === 'api' ? `the Claude API (${oracle.model})`
      : want === 'mock' ? 'the mock answers (ORACLE=mock)'
      : `Claude Code was not found${tried.length ? ` (${tried.join('; ')})` : ' on PATH or in the usual install locations'}; the mock answers`;
    log(`oracle: ${kind}${oracle.describe ? ` (${oracle.describe()})` : ''} · repo: ${repo || 'none'}`);
    return status();
  }

  function status() {
    return {
      oracle: kind, ready: !!oracle, linked: !!oracle && kind !== 'mock',
      needsRepo: kind !== 'mock' && !repo,
      model: oracle?.model || null,
      repo: repo ? basename(repo) : null, repoPath: repo,
      claude: claude ? { path: claude.path, version: claude.version } : null,
      note,
    };
  }

  async function setRepo(dir) {
    if (!dir || !await isDir(dir)) throw new Error(`not a folder: ${dir}`);
    repo = resolve(dir); settings.repo = repo; await save();
    return setup();
  }

  async function ask({ id, question, session }, emit = () => {}) {
    question = String(question || '').trim().slice(0, 4000);
    session = /^[\w.-]{1,64}$/.test(String(session || '')) ? String(session) : 'default';
    if (!question) throw new Error('no question');
    if (!oracle) throw new Error(note || 'the gate has no oracle');
    for (const r of running.values()) if (r.session === session) throw new Error('the gate is busy with your last question');
    const ac = new AbortController();
    running.set(id, { ac, session });
    try {
      const { answer } = await oracle.ask({ question, session, emit, signal: ac.signal });
      if (ac.signal.aborted) throw new Error('aborted');
      return answer;
    }
    catch (e) { throw ac.signal.aborted ? new Error('aborted') : e; }
    finally { running.delete(id); }
  }
  const cancel = id => running.get(id)?.ac.abort();
  function cancelAll() { for (const r of running.values()) r.ac.abort(); }
  async function close() { cancelAll(); await oracle?.close?.(); oracle = null; }

  await setup();
  return { status, setup, setRepo, ask, cancel, cancelAll, close, settingsFile };
}
