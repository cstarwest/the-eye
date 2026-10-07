'use strict';
// ----------------------------- BACKEND -------------------------------
// The one touchpoint. With CONFIG.api set (?api=..., or a bridge detected on
// the page's own origin) it POSTs { question, session } to <api>/ask and reads
// the server-sent stream: delta (text), tool/status (what the oracle is doing),
// done, error. Without it, a mock oracle answers in character, streamed the
// same way, so the rest of the page never knows the difference.
//
// Bridging: probe(base) asks one endpoint for /health. detectBridge() runs at
// wake: the page's own origin, ?api=, or an endpoint the setup panel saved.
// autoBridge() is the setup panel's button: the same, then localhost. Every
// probe reports on the bus as 'bridge' so the setup panel stays current.
const Bridge = (() => {
  const STORE = 'gatekeeper.api';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; } })();
  if (CONFIG.api === null && saved && saved.api) { CONFIG.api = saved.api; CONFIG.key = CONFIG.key || saved.key || null; }
  const remember = (api, key) => { try { api ? localStorage.setItem(STORE, JSON.stringify({ api, key: key || null })) : localStorage.removeItem(STORE); } catch (e) {} };
  const trim = s => String(s || '').trim().replace(/\/+$/, '');
  const report = extra => Bus.emit('bridge', { linked: CONFIG.linked, api: CONFIG.api, oracle: CONFIG.oracle, model: CONFIG.model, repo: CONFIG.repo, probe: CONFIG.lastProbe, ...extra });

  async function probe(base, key = CONFIG.key) {
    const r = await fetch(trim(base) + '/health', { headers: key ? { 'x-gatekeeper-key': key } : {}, signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(2500) : undefined });
    if (!r.ok) throw new Error(`${r.status} from ${base || 'this origin'}`);
    const j = await r.json();
    if (!j || !j.gatekeeper) throw new Error(`${base || 'this origin'} is not a gatekeeper bridge`);
    return j;
  }
  function link(base, j, key) {
    CONFIG.api = trim(base); if (key !== undefined) CONFIG.key = key; CONFIG.linked = true;
    CONFIG.oracle = String(j.oracle || 'live').replace(/-/g, ' ').toUpperCase(); CONFIG.model = j.model || null; CONFIG.repo = j.repo || null;
    CONFIG.lastProbe = `linked to ${CONFIG.api || 'this origin'}`;
    if (base) remember(CONFIG.api, CONFIG.key);
    report({ event: 'linked' });
  }
  function unlink(why) {
    CONFIG.linked = false; CONFIG.oracle = CONFIG.api !== null ? 'LIVE' : null; CONFIG.model = null; CONFIG.repo = null; CONFIG.lastProbe = why || '';
    report({ event: 'unlinked' });
  }
  // the quiet probe at wake: never reaches out to anything the page was not told about
  async function detect() {
    if (CONFIG.api === null && location.protocol === 'file:') { CONFIG.lastProbe = 'no bridge: the page is open as a file. Use BRIDGE TO CLAUDE, or ?api='; report({ event: 'skipped' }); return false; }
    const base = CONFIG.api === null ? '' : CONFIG.api;
    report({ event: 'probing', target: base || location.origin });
    try { link(base, await probe(base)); return true; }
    catch (e) { unlink(`${base || location.origin}: ${e.message || e}`); return false; }
  }
  // the setup panel's button: this origin, the remembered endpoint, then localhost
  async function auto(candidates = CONFIG.candidates) {
    const tried = [], targets = [];
    if (location.protocol !== 'file:') targets.push('');
    if (CONFIG.api) targets.push(CONFIG.api);
    targets.push(...candidates);
    for (const base of targets.filter((b, i, a) => a.indexOf(b) === i)) {
      report({ event: 'probing', target: base || location.origin });
      try { const j = await probe(base); link(base, j); return { ok: true, api: CONFIG.api, oracle: CONFIG.oracle }; }
      catch (e) { tried.push(`${base || location.origin}: ${String(e.message || e).replace(/^TypeError: /, '')}`); }
    }
    unlink(`no bridge found. Tried ${tried.length}: ${tried.join(' · ')}`);
    return { ok: false, tried };
  }
  // the setup panel's form: one endpoint, with an optional secret
  async function connect(base, key) {
    base = trim(base); key = String(key || '').trim() || null;
    if (!base) return { ok: false, error: 'enter the bridge address, like http://localhost:3000' };
    if (!/^https?:\/\//.test(base)) base = 'http://' + base;
    report({ event: 'probing', target: base });
    try { link(base, await probe(base, key), key); return { ok: true, api: CONFIG.api, oracle: CONFIG.oracle }; }
    catch (e) { unlink(`${base}: ${String(e.message || e).replace(/^TypeError: /, '')}`); return { ok: false, error: CONFIG.lastProbe }; }
  }
  function forget() { remember(null); CONFIG.api = null; CONFIG.key = null; unlink('bridge forgotten; the mock answers'); }
  return { probe, detect, auto, connect, forget, status: () => ({ linked: CONFIG.linked, api: CONFIG.api, oracle: CONFIG.oracle, model: CONFIG.model, repo: CONFIG.repo, probe: CONFIG.lastProbe }) };
})();
const detectBridge = Bridge.detect;
async function askClaude(question, { onDelta = () => {}, onEvent = () => {}, signal } = {}) {
  if (CONFIG.api !== null) {
    const r = await fetch(CONFIG.api.replace(/\/$/, '') + '/ask', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(CONFIG.key ? { 'x-gatekeeper-key': CONFIG.key } : {}) },
      body: JSON.stringify({ question, session: CONFIG.session }),
    });
    if (!r.ok) { let m = `the gate returned ${r.status}`; try { m = (await r.json()).error || m; } catch (e) {} throw new Error(m); }
    if (!/text\/event-stream/.test(r.headers.get('content-type') || '')) return String((await r.json()).answer);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '', text = '', done = null;
    while (true) {
      const { value, done: end } = await reader.read(); if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const dataLine = chunk.split('\n').find(l => l.startsWith('data:')); if (!dataLine) continue;
        let ev; try { ev = JSON.parse(dataLine.slice(5)); } catch (e) { continue; }
        if (ev.type === 'delta') { text += ev.text; onDelta(ev.text); }
        else if (ev.type === 'tool' || ev.type === 'status') onEvent(ev.label || ev.text || '');
        else if (ev.type === 'done') done = String(ev.answer ?? text);
        else if (ev.type === 'error') throw new Error(ev.message || 'the session failed');
      }
    }
    if (done === null && !text) throw new Error('the session went silent');
    return done ?? text;
  }
  // ---- mock oracle (no server): in character, keyword-aware, streamed word by word
  await wait(rnd(500, 900)); onEvent('SCANNING /');
  await wait(rnd(500, 900)); onEvent('READING SRC/MAIN.TS');
  await wait(rnd(400, 800));
  const q = question.toLowerCase();
  const rules = [
    [/test|spec|coverage/, 'There are 214 tests. Three are skipped, and I would not trust the skipped ones. The slowest suite is the integration run against the fixtures in test/fixtures; it alone takes forty seconds.'],
    [/auth|login|token|session|password/, 'Authentication lives in src/auth. It issues short-lived access tokens and refreshes them silently from an httpOnly cookie. Nothing else should ever read that cookie. One module tries. Look at it.'],
    [/build|deploy|ci|pipeline|release/, 'The build runs through Vite. Dev server on port 5173, production bundle in dist. Deploys go out from the release workflow on tags only. Pushing to main deploys nothing. That is deliberate.'],
    [/db|database|migrat|prisma|sql|schema/, 'The database layer uses Prisma. Migrations are in prisma/migrations and are generated, never written by hand. The schema has a soft-delete flag that two queries forget to honour.'],
    [/bug|error|crash|fail|broken|why/, 'The failure begins at the boundary: the event bus in packages/core delivers out of order under load, and the consumer assumes order. Fix the consumer. The bus will not change for you.'],
    [/who|what are you|your name|yourself/, 'I am what watches the session when you are not looking. I keep the context. I keep the keys. You keep winning my games, and we will keep speaking.'],
    [/api|endpoint|route|rest|graphql/, 'The public API is defined once, in packages/api/schema. The route handlers are generated from it. If a route exists that the schema does not describe, it is a ghost. Remove it.'],
    [/perf|slow|fast|latency|memory/, 'The slow path is the serializer. It walks the object graph twice. Cache the first walk and you reclaim most of what you are losing. The rest is the network, and the network is not mine.'],
  ];
  const found = rules.find(([re]) => re.test(q));
  const text = found ? found[1] : pick([
    'That service is deprecated. The replacement is the event bus in packages/core. Everything still calling the old one is listed in the deprecation report. Nobody has read it.',
    'The entry point is src/main.ts. It wires the router, the store and the telemetry, in that order, and the order matters more than the comments admit.',
    'The configuration is layered: defaults, then the environment file, then flags. Flags win. Someone shipped a flag that is always on. It is the third one.',
    'The module you are asking about is six hundred lines, and a third of them are dead. I can tell you which third. Ask again, and ask better.',
    'Two code paths do the same work. One of them is correct. The tests cover the other.',
  ]);
  let out = '';
  for (const w of text.split(/(?<=\s)/)) { if (signal && signal.aborted) break; out += w; onDelta(w); await wait(rnd(25, 60)); }
  return out;
}
