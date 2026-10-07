'use strict';
// ------------------------------- SETUP -------------------------------
// The faint gear in the top-left corner. It opens a card with the bridge
// status (is the page talking to a real Claude, and which oracle), a button
// that finds a bridge on its own, a form for a remote one, and the
// instructions for starting one. The gear's dot shows the link state at a
// glance: hollow when the mock answers, filled when a bridge is linked.
const Setup = (() => {
  const btn = $('setup-btn'), card = $('setup'), auto = $('bridge-auto'), form = $('bridge-form'), urlEl = $('bridge-url'), keyEl = $('bridge-key'), forget = $('bridge-forget'), result = $('bridge-result');
  const field = id => $(id);
  let open = false;

  function render(st = Bridge.status()) {
    btn.dataset.link = st.linked ? 'on' : 'off';
    btn.title = st.linked ? `bridged · ${st.oracle || 'live'}${st.model ? ' · ' + st.model : ''}` : 'setup · not bridged (mock answers)';
    field('st-link').textContent = st.linked ? 'LINKED' : (CONFIG.api !== null ? 'NOT ANSWERING' : 'NOT LINKED · MOCK ANSWERS');
    field('st-link').className = st.linked ? 'on' : '';
    field('st-api').textContent = st.api === null ? '—' : (st.api || location.origin);
    field('st-oracle').textContent = st.linked ? (st.oracle || 'LIVE') : (CONFIG.api !== null ? '—' : 'MOCK (in the page)');
    field('st-model').textContent = st.linked && st.model ? st.model : '—';
    field('st-repo').textContent = st.linked && st.repo ? st.repo : '—';
    field('st-session').textContent = CONFIG.session.toUpperCase();
    field('st-probe').textContent = st.probe || '—';
    forget.style.display = CONFIG.api !== null ? '' : 'none';
    if (!urlEl.value && CONFIG.api) urlEl.value = CONFIG.api;
  }
  Bus.on('bridge', ev => {
    if (ev.event === 'probing') { btn.dataset.link = 'probing'; field('st-probe').textContent = `probing ${ev.target}…`; return; }
    render(ev);
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

  async function autoBridge(candidates) {
    if (auto.classList.contains('live')) return null;
    auto.classList.add('live'); auto.textContent = 'SEARCHING…'; result.textContent = '';
    try {
      const r = await Bridge.auto(candidates);
      result.textContent = r.ok ? `bridged to ${r.api || location.origin} · ${r.oracle}` : 'no bridge answered. Start one (below), then try again.';
      r.ok ? Audio_.sfx.win() : Audio_.sfx.hurt();
      return r;
    } finally { auto.classList.remove('live'); auto.textContent = 'BRIDGE TO CLAUDE'; render(); }
  }
  auto.addEventListener('click', () => autoBridge());
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const r = await Bridge.connect(urlEl.value, keyEl.value);
    result.textContent = r.ok ? `bridged to ${r.api} · ${r.oracle}` : r.error;
    r.ok ? Audio_.sfx.win() : Audio_.sfx.hurt(); render();
  });
  forget.addEventListener('click', () => { Bridge.forget(); urlEl.value = ''; keyEl.value = ''; result.textContent = 'forgotten. The mock answers until you bridge again.'; render(); });

  render();
  return { show, toggle: () => show(!open), isOpen: () => open, autoBridge, render };
})();
