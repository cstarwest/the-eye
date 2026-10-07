// Optional bridge between the page and a real Claude Code session.
// Serves index.html and exposes POST /ask { question } -> { answer } by running
// `claude -p "<question>"` headlessly in REPO. No dependencies. Node 18+.
//
//   REPO=/path/to/repo node server.mjs
//   PORT=3000 GATEKEEPER_SECRET=... CLAUDE_BIN=claude node server.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const REPO = process.env.REPO || process.cwd();
const SECRET = process.env.GATEKEEPER_SECRET || '';
const BIN = process.env.CLAUDE_BIN || 'claude';
const TIMEOUT_MS = 180_000;

function ask(question) {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, ['-p', question, '--output-format', 'text'], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('the session took too long')); }, TIMEOUT_MS);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `claude exited with ${code}`)); });
  });
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-gatekeeper-key', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, ...cors }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index.html') || req.url.startsWith('/?')))
    return send(res, 200, await readFile(join(here, 'index.html')), 'text/html; charset=utf-8');
  if (req.method === 'POST' && req.url === '/ask') {
    if (SECRET && req.headers['x-gatekeeper-key'] !== SECRET) return send(res, 401, { error: 'the gate does not know you' });
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) return send(res, 413, { error: 'too long' }); }
    let question;
    try { question = String(JSON.parse(raw).question || '').trim(); } catch { return send(res, 400, { error: 'bad json' }); }
    if (!question) return send(res, 400, { error: 'no question' });
    try { send(res, 200, { answer: await ask(question) }); }
    catch (e) { send(res, 502, { error: e.message }); }
    return;
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log(`gatekeeper on http://localhost:${PORT}  (repo: ${REPO}${SECRET ? ', secret set' : ''})`));
