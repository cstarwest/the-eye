'use strict';
// ------------------------------- SETUP -------------------------------
// The faint gear in the top-left corner. It opens a card with the bridge
// status (is a real Claude answering, which oracle, which Claude Code, which
// repository), a button that looks for Claude Code again, one that opens the
// folder picker, and the short version of the setup instructions. The gear's
// dot shows the link state at a glance: hollow when the mock answers (or
// nothing can), filled when Claude is linked. The card opens by itself when a
// repository has to be chosen before Claude can answer.
const Setup = (() => {
  const btn = $('setup-btn'), card = $('setup'), auto = $('bridge-auto'), repoBtn = $('bridge-repo'), result = $('bridge-result');
  const field = id => $(id);
  let open = false;

  function render(st = Bridge.status()) {
    btn.dataset.link = st.linked ? 'on' : 'off';
    btn.title = st.linked ? `linked · ${st.oracle}${st.repo ? ' · ' + st.repo : ''}` : st.needsRepo ? 'setup · choose a repository' : `setup · not linked${st.ready ? ' (mock answers)' : ''}`;
    field('st-link').textContent = st.linked ? 'LINKED' : st.needsRepo ? 'CHOOSE A REPOSITORY' : st.ready ? 'NOT LINKED · MOCK ANSWERS' : 'NOT LINKED';
    field('st-link').className = st.linked ? 'on' : '';
    field('st-oracle').textContent = st.oracle || '—';
    field('st-claude').textContent = st.claude ? `${st.claude.version} · ${st.claude.path}` : 'not found';
    field('st-model').textContent = st.linked && st.model ? st.model : '—';
    field('st-repo').textContent = st.repoPath || '—';
    field('st-session').textContent = CONFIG.session.toUpperCase();
    field('st-probe').textContent = st.probe || '—';
    repoBtn.classList.toggle('want', !!st.needsRepo);
    repoBtn.disabled = !CONFIG.desktop; auto.disabled = !CONFIG.desktop;
  }
  let asked = false;
  Bus.on('bridge', ev => {
    if (ev.event === 'probing') { btn.dataset.link = 'probing'; field('st-probe').textContent = `looking for ${ev.target}…`; return; }
    render();
    if (CONFIG.needsRepo && !asked) { asked = true; show(true); result.textContent = 'Choose the repository the gatekeeper reads.'; }
  });

  function show(v) {
    open = v;
    card.classList.toggle('on', open); btn.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open));
    if (open) { render(); Gate.touch(); if (Eye.mood() === 'idle' || Eye.mood() === 'friendly') { Eye.look({ x: -.85, y: -.7 }); setTimeout(() => Eye.look(null), 900); } Audio_.sfx.blip(); }
  }
  btn.addEventListener('click', e => { e.stopPropagation(); show(!open); });
  card.addEventListener('pointerdown', e => e.stopPropagation());
  addEventListener('pointerdown', () => { if (open) show(false); });
  $('setup-close').addEventListener('click', () => show(false));

  async function busyWhile(el, label, run) {
    if (el.classList.contains('live')) return null;
    const idle = el.textContent; el.classList.add('live'); el.textContent = label; result.textContent = '';
    try { return await run(); } finally { el.classList.remove('live'); el.textContent = idle; render(); }
  }
  async function autoBridge() {
    return busyWhile(auto, 'SEARCHING…', async () => {
      const r = await Bridge.auto();
      result.textContent = r.ok ? `linked · ${r.oracle}${r.repo ? ' · ' + r.repo : ''}` : r.needsRepo ? 'Claude Code is ready. Choose a repository.' : r.probe || 'Claude Code was not found.';
      r.ok ? Audio_.sfx.win() : Audio_.sfx.hurt();
      return r;
    });
  }
  async function chooseRepo() {
    return busyWhile(repoBtn, 'CHOOSING…', async () => {
      const before = CONFIG.repoPath, r = await Bridge.chooseRepo();
      if (r.repoPath && r.repoPath !== before) { result.textContent = `reading ${r.repoPath}`; Audio_.sfx.win(); }
      return r;
    });
  }
  auto.addEventListener('click', () => autoBridge());
  repoBtn.addEventListener('click', () => chooseRepo());

  render();
  return { show, toggle: () => show(!open), isOpen: () => open, autoBridge, chooseRepo, render };
})();
