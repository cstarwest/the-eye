'use strict';
// ----------------------------- BACKEND -------------------------------
// The one touchpoint. The desktop app's main process runs the bridge
// (desktop/bridge.mjs): it finds Claude Code on this machine, keeps the chosen
// repository and answers through Claude Code, the Claude API or a mock. The
// page reaches it through window.gatekeeper (desktop/preload.cjs); questions
// stream back as events: delta (text), tool/status (what the oracle is doing).
//
// Bridge.detect() runs at wake, Bridge.auto() is the setup card's FIND button
// (look for Claude Code again), Bridge.chooseRepo() opens the folder picker.
// Every report goes out on the bus as 'bridge' so the setup card stays current.
const Bridge = (() => {
  const desk = window.gatekeeper || null;
  const LABEL = { 'claude-code': 'CLAUDE CODE', api: 'API', mock: 'MOCK' };
  const report = extra => Bus.emit('bridge', { linked: CONFIG.linked, oracle: CONFIG.oracle, model: CONFIG.model, repo: CONFIG.repo, probe: CONFIG.lastProbe, ...extra });
  function apply(st, event = 'status') {
    Object.assign(CONFIG, {
      linked: !!st.linked, oracle: st.oracle ? LABEL[st.oracle] || String(st.oracle).toUpperCase() : null,
      model: st.model || null, repo: st.repo || null, repoPath: st.repoPath || null,
      claude: st.claude || null, needsRepo: !!st.needsRepo, ready: !!st.ready, lastProbe: st.note || '',
    });
    report({ event });
    return status();
  }
  const status = () => ({ linked: CONFIG.linked, ready: CONFIG.ready, oracle: CONFIG.oracle, model: CONFIG.model, repo: CONFIG.repo, repoPath: CONFIG.repoPath, claude: CONFIG.claude, needsRepo: CONFIG.needsRepo, probe: CONFIG.lastProbe });
  const missing = () => { CONFIG.lastProbe = 'not running in the desktop app: start it with npm start'; report({ event: 'unlinked' }); return status(); };
  if (desk) desk.onStatus(st => apply(st));

  async function detect() { if (!desk) return missing(); return apply(await desk.status()); }
  async function auto() {
    if (!desk) return { ok: false, ...missing() };
    report({ event: 'probing', target: 'Claude Code' });
    const st = apply(await desk.redetect());
    return { ok: st.linked, ...st };
  }
  async function chooseRepo() { if (!desk) return missing(); return apply(await desk.chooseRepo()); }
  return { detect, auto, chooseRepo, status };
})();

async function askClaude(question, { onDelta = () => {}, onEvent = () => {}, signal } = {}) {
  const desk = window.gatekeeper;
  if (!desk) throw new Error('This page runs inside the Gatekeeper desktop app. Start it with npm start.');
  const id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const onAbort = () => desk.cancel(id);
  if (signal) { if (signal.aborted) throw new Error('aborted'); signal.addEventListener('abort', onAbort, { once: true }); }
  let text = '';
  try {
    const r = await desk.ask(id, question, CONFIG.session, ev => {
      if (!ev) return;
      if (ev.type === 'delta') { text += ev.text; onDelta(ev.text); }
      else if (ev.type === 'tool' || ev.type === 'status') onEvent(ev.label || ev.text || '');
    });
    if (!r.ok) throw new Error(r.error || 'the session failed');
    if (r.answer == null && !text) throw new Error('the session went silent');
    return String(r.answer ?? text);
  } finally { if (signal) signal.removeEventListener('abort', onAbort); }
}
