'use strict';
// ------------------------------ ARENA --------------------------------
// One-bit games on a 160x240 logical canvas, letterboxed at an integer scale.
// A game is { name, brief, help, init(level) -> state, step(state, dt) -> true
// (win) | false (lose) | undefined (continue), draw(state) }. `level` is that
// game's own tier: how often the player has beaten it, kept across visits (see
// `skill` at the end); every game gets a little harder with it, and every game
// escalates while it runs. A trial is a handful of seconds, enough for a few
// meaningful moves, easy for a beat before it bites. Optional state fields the
// arena reads:
// `heat` (0..1, the music climbs with it), `danger` (the frame pulses red and
// an alarm joins the beat), `look` ({x, y} in arena pixels: where the eye
// behind the arena stares; otherwise it follows `px` / `x`), `inverted` (draw
// the whole screen negative) and `why` (a line under TERMINATED). Pure black
// and white: danger is shown by inverting the screen, never by colour.
//
// The games live in web/js/games/*.js. Each one calls Arena.define(kit => def)
// and receives the drawing and input helpers below as `kit`; the order the
// scripts are loaded in is the order of Arena.GAMES.
const Arena = (() => {
  const GW = 160, GH = 240;
  const stage = $('stage'), gc = $('gc'), g = gc.getContext('2d'), title = $('gtitle'), help = $('ghelp');
  gc.width = GW; gc.height = GH;
  const keys = {}; let pointerX = null, invert = 0, shakeT = 0, particles = [], resolveNow = null, current = null;
  // Discrete inputs since the last frame, as directions: 0 up · 1 right · 2 down · 3 left
  // (arrows / WASD, or a tap, read by its quadrant around the centre of the arena).
  let taps = [], presses = 0;
  const DIRS = { ArrowUp: 0, w: 0, ArrowRight: 1, d: 1, ArrowDown: 2, s: 2, ArrowLeft: 3, a: 3 };
  // letters are kept lower-case, so a key pressed as 'a' and released as 'A' (Shift in between) is still released
  const keyOf = e => e.key.length === 1 ? e.key.toLowerCase() : e.key;
  addEventListener('keydown', e => {
    const k = keyOf(e); keys[k] = true;
    if (!stage.classList.contains('on')) return;
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    if (!e.repeat && k in DIRS) taps.push(DIRS[k]);
    if (!e.repeat && (k in DIRS || k === ' ')) presses++;
  });
  addEventListener('keyup', e => { keys[keyOf(e)] = false; });
  // a window that loses focus never hears the key or button come up: let go of everything
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; pointerX = null; presses = 0; });
  const toLocal = e => { const r = gc.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width * GW, 0, GW), y: clamp((e.clientY - r.top) / r.height * GH, 0, GH) }; };
  stage.addEventListener('pointerdown', e => { const p = toLocal(e), dx = p.x - GW / 2, dy = p.y - GH / 2; pointerX = p.x; keys.fire = true; presses++; taps.push(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0)); });
  stage.addEventListener('pointermove', e => { if (pointerX !== null) pointerX = toLocal(e).x; });
  addEventListener('pointerup', () => { pointerX = null; keys.fire = false; });
  addEventListener('pointercancel', () => { pointerX = null; keys.fire = false; });
  function fit() {
    const pad = 70, s = Math.max(1, Math.floor(Math.min((innerWidth - 16) / GW, (innerHeight - pad * 2) / GH)));
    const w = GW * s, h = GH * s, left = Math.round((innerWidth - w) / 2), top = Math.round((innerHeight - h) / 2);
    gc.style.width = w + 'px'; gc.style.height = h + 'px'; gc.style.left = left + 'px'; gc.style.top = top + 'px';
    title.style.top = Math.max(10, top - 34) + 'px'; help.style.top = Math.min(innerHeight - 24, top + h + 14) + 'px';
  }
  addEventListener('resize', fit);

  // drawing helpers (white unless told otherwise)
  const px = (x, y, w = 1, h = 1, c = '#fff') => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  // 3x5 pixel font so in-game text stays one-bit (no antialiased canvas text)
  const FONT = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
    A: '010101111101101', B: '110101110101110', C: '111100100100111', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '111100101101111', H: '101101111101101', I: '111010010010111', J: '001001001101111', K: '101101110101101', L: '100100100100111', M: '101111111101101',
    N: '110101101101101', O: '111101101101111', P: '111101111100100', Q: '111101101111001', R: '111101110101101', S: '111100111001111', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
    '/': '001001010100100', '.': '000000000000010', ':': '000010000010000', '-': '000000111000000', ' ': '000000000000000' };
  const text = (s, y, c = '#fff', k = 1) => {
    s = String(s).toUpperCase(); const x0 = Math.round((GW - (s.length * 4 * k - k)) / 2);
    for (let i = 0; i < s.length; i++) { const bits = FONT[s[i]]; if (!bits) continue; for (let b = 0; b < 15; b++) if (bits[b] === '1') px(x0 + i * 4 * k + (b % 3) * k, y + ((b / 3) | 0) * k, k, k, c); }
  };
  const sprite = (rows, x, y, c) => rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') px(x + i, y + j, 1, 1, c); });
  const burst = (x, y, n, sp = 60) => { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = rnd(sp * .3, sp); particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: rnd(.25, .6) }); } };
  const shake = n => { shakeT = Math.max(shakeT, n); if (!CONFIG.reducedMotion) { document.body.classList.remove('shake'); void document.body.offsetWidth; document.body.classList.add('shake'); } };
  const flash = () => { invert = .08; };
  const note = (s, msg, sec = 1.1) => { s._note = { msg, t: sec }; };     // a banner that blinks over the arena for a moment
  const takeTaps = () => { const t = taps; taps = []; return t; };
  // One-button timing games need queued presses too: a Space tap can begin and
  // end between frames. Directions and pointer taps count once; holds never do.
  const takePresses = () => { const n = presses; presses = 0; return n; };
  const setSpeed = (b, v) => { const m = Math.hypot(b.vx, b.vy) || 1; b.vx *= v / m; b.vy *= v / m; };
  const paddleInput = (x, w, speed, dt) => {
    if (pointerX !== null) return clamp(pointerX - w / 2, 0, GW - w);
    if (keys.ArrowLeft || keys.a) x -= speed * dt;
    if (keys.ArrowRight || keys.d) x += speed * dt;
    return clamp(x, 0, GW - w);
  };
  const firing = () => !!(keys[' '] || keys.ArrowUp || keys.w || keys.fire || pointerX !== null);

  async function countdown(def, lvl) {
    const brief = typeof def.brief === 'function' ? def.brief(lvl) : def.brief;
    for (let n = 3; n > 0; n--) {
      g.fillStyle = '#000'; g.fillRect(0, 0, GW, GH);
      text(def.name, 86, '#fff', 2); text(brief, 104, '#888'); if (lvl) text(`TIER ${lvl + 1}`, 114, '#fff');
      text(String(n), 130, '#fff', 6); Audio_.sfx.count(false); await wait(440);
    }
    g.fillStyle = '#fff'; g.fillRect(0, 0, GW, GH); Audio_.sfx.count(true); await wait(90);
  }
  function run(def, lvl = 0) {
    return new Promise(async res => {
      stage.classList.add('on'); stage.classList.remove('white', 'danger'); fit();
      title.textContent = def.name; help.textContent = Array.isArray(def.help) ? def.help[matchMedia('(pointer: coarse)').matches ? 0 : 1] : def.help || '';
      particles = []; invert = 0; shakeT = 0; pointerX = null; keys.fire = false; taps = []; presses = 0;
      await countdown(def, lvl);
      const st = def.init(lvl); st.lvl = lvl; current = st;
      let last = performance.now(), over = null, heat = -1, heatAt = 0;
      resolveNow = r => { over = r; };
      const frame = now => {
        const dt = Math.min(.05, (now - last) / 1000); last = now;
        if (over === null) { const r = def.step(st, dt); if (r !== undefined) over = r; }
        taps = []; presses = 0;
        // the eye behind the arena watches; the music climbs with the game; danger is seen and heard
        const plx = st.px ?? st.x;
        if (st.look) Eye.look({ x: st.look.x / GW * 2 - 1, y: st.look.y / GH * 2 - 1 }); else if (plx !== undefined) Eye.look({ x: (plx + (st.pw || 8) / 2) / GW * 2 - 1, y: .25 });
        if (over === null && st.heat !== undefined && now - heatAt > 400 && Math.abs(st.heat - heat) > .03) { heat = clamp(st.heat, 0, 1); heatAt = now; Audio_.setIntensity(.7 + heat * .3); }
        const danger = over === null && !!st.danger; stage.classList.toggle('danger', danger); Audio_.setDanger(danger);
        if (over !== null && !st._endAt) { st._endAt = now; over ? Audio_.sfx.win() : Audio_.sfx.hurt(); if (!over) { shake(.5); flash(); buzz([60, 40, 120]); } else buzz(30); }
        particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 90 * dt; p.t -= dt; }); particles = particles.filter(p => p.t > 0);
        g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, GW, GH);
        if (shakeT > 0) { shakeT -= dt; g.translate(Math.round(rnd(-2, 2)), Math.round(rnd(-2, 2))); }
        def.draw(st);
        particles.forEach(p => px(p.x, p.y, 1, 1));
        if (st._note && over === null) { const n = st._note; n.t -= dt; if (n.t <= 0) st._note = null; else if (Math.floor(n.t * 12) % 3) { px(0, 184, GW, 20); text(n.msg, n.msg.length > 19 ? 192 : 189, '#000', n.msg.length > 19 ? 1 : 2); } }
        if (over !== null) {
          const e = (now - st._endAt) / 1000, why = over ? null : st.why;
          if (e > .15) {
            px(0, GH / 2 - 16, GW, 32, over ? '#fff' : '#000'); if (!over) { px(0, GH / 2 - 16, GW, 1); px(0, GH / 2 + 15, GW, 1); }
            text(over ? 'BREACH SUCCESSFUL' : 'TERMINATED', GH / 2 - (why ? 11 : 5), over ? '#000' : '#fff', 2);
            if (why) text(why, GH / 2 + 3, '#fff');
          }
          if (e > 1.2) { stage.classList.remove('on', 'danger'); Audio_.setDanger(false); resolveNow = null; current = null; Eye.look(null); return res(over); }
        }
        if (invert > 0 || st.inverted) { if (invert > 0) invert -= dt; g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'difference'; g.fillStyle = '#fff'; g.fillRect(0, 0, GW, GH); g.globalCompositeOperation = 'source-over'; }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  // ---- skill: every game remembers how often it has been beaten, across visits. A win
  //      raises that game's tier for its next trial by one; two losses in a row lower it
  //      by one, so a trial stays winnable. Each tier is a nudge, never a wall.
  const GAMES = [], TIERS = 9, SKILL_KEY = 'gatekeeper.skill';
  const kit = { GW, GH, g, px, text, sprite, burst, shake, flash, note, takeTaps, takePresses, setSpeed, paddleInput, firing };
  const define = factory => { const def = factory(kit); GAMES.push(def); return def; };
  let skill = {}, lastGame = null;
  try { skill = JSON.parse(localStorage.getItem(SKILL_KEY) || '{}') || {}; } catch (e) { skill = {}; }
  const save = () => { try { localStorage.setItem(SKILL_KEY, JSON.stringify(skill)); } catch (e) {} };
  const tier = def => clamp((skill[def.name] || {}).tier | 0, 0, TIERS);
  function record(def, won) {
    const k = skill[def.name] || (skill[def.name] = { tier: 0, lost: 0, played: 0, won: 0 });
    k.played++;
    if (won) { k.won++; k.lost = 0; k.tier = Math.min(TIERS, k.tier + 1); }
    else if (++k.lost >= 2) { k.lost = 0; k.tier = Math.max(0, k.tier - 1); }
    save(); return k.tier;
  }
  function random() { let gm; do gm = pick(GAMES); while (gm === lastGame && GAMES.length > 1); lastGame = gm; return gm; }
  async function trial() { const def = random(), won = await run(def, tier(def)); record(def, won); return won; }
  return {
    GAMES, define, kit, run, random, tier, record, trial,
    byName: n => GAMES.find(x => x.name.toLowerCase().includes(n.toLowerCase())),
    skill: () => JSON.parse(JSON.stringify(skill)),      // what each game remembers: { tier, won, lost (in a row), played }
    forget() { skill = {}; save(); },                     // every game starts from the first tier again
    end: r => resolveNow && resolveNow(r),                // debug / test hook: finish the running game
    current: () => current,                               // debug / test hook: the running game's state
  };
})();
