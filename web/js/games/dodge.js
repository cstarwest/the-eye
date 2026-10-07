'use strict';
// DODGE: one of the gatekeeper's trials. See web/js/arena.js for the kit it receives.
Arena.define(({ GW, GH, px, text, shake, note, paddleInput }) => {
  // ---- 3. OUTRUN THE STATIC: falling static and barred gates, then seekers that hunt
  //      your position (and commit to a column before they reach you), then lashes that
  //      whip in from the edges and cover half the screen; the last four seconds run
  //      negative and a quarter faster. Seven seconds, a little more per tier. One
  //      life, so nothing is allowed to coincide with a gate in a way that leaves no
  //      room: static never spawns into a gate's gap it would arrive with, and a lash
  //      comes from the side that leaves the gap open.
  const DODGE = {
    name: 'OUTRUN THE STATIC', brief: lvl => `SURVIVE ${7 + Math.min(3, Math.ceil(lvl / 3))} SECONDS. ONE LIFE.`, help: ['DRAG TO MOVE', '← → OR A D TO MOVE'],
    init: lvl => ({ x: 76, rocks: [], bars: [], seekers: [], lashes: [], t: 0, goal: 7 + Math.min(3, Math.ceil(lvl / 3)), spawn: .25, bar: 1.2, seek: .6, lash: .5, near: 0, phase: 0, heat: 0, danger: false, inverted: false }),
    step: (s, dt) => {
      const od = s.t > s.goal - 2.5, m = (od ? 1.25 : 1) * (1 + s.lvl * .02);
      s.t += dt; s.spawn -= dt * m; s.bar -= dt * m; s.seek -= dt; s.lash -= dt; s.x = paddleInput(s.x, 8, 215, dt);
      if (s.phase < 1 && s.t > 2) { s.phase = 1; note(s, 'SEEKERS', .7); Audio_.sfx.thud(); }
      if (s.phase < 2 && s.t > 4) { s.phase = 2; note(s, 'LASHES', .7); Audio_.sfx.thud(); }
      if (s.phase < 3 && od) { s.phase = 3; s.inverted = true; note(s, 'OVERDRIVE', .7); Audio_.sfx.glitch(); shake(.4); buzz([30, 30, 30]); }
      const py = GH - 16, arrives = o => (py - o.y) / o.v;                 // seconds until something reaches you
      if (s.spawn <= 0) {
        const r = { x: rnd(0, GW - 6), y: -6, v: (80 + s.t * 14) * m, w: rnd(4, 10) | 0 };
        for (let i = 0; i < 4 && s.bars.some(b => Math.abs(arrives(b) - arrives(r)) < .45 && r.x + r.w > b.gap - 2 && r.x < b.gap + b.gw + 2); i++) r.x = rnd(0, GW - 6);
        s.rocks.push(r); s.spawn = Math.max(.1, .3 - s.t * .03);
      }
      if (s.bar <= 0) { const gw = Math.max(22, 30 + Math.max(0, 4 - s.t * .8) - s.lvl), gap = rnd(6, GW - gw - 6); s.bars.push({ y: -4, gap, gw, v: (60 + s.t * 7) * m }); s.bar = Math.max(1.1, rnd(1.5, 2.3) - s.t * .1); }
      if (s.phase >= 1 && s.seek <= 0) { s.seekers.push({ x: rnd(4, GW - 12), y: -8, vy: (70 + s.t * 6) * m }); s.seek = Math.max(1, 1.8 - s.t * .1); }
      if (s.phase >= 2 && s.lash <= 0) {
        const warn = Math.max(.45, .7 - s.t * .03), coming = s.bars.filter(b => arrives(b) > warn - .1).sort((a, b) => arrives(a) - arrives(b));   // the gates still to pass once the lash is out
        const bar = coming.find(b => arrives(b) < warn + 1.1) || coming[0];
        const side = bar ? (bar.gap + bar.gw / 2 < GW / 2 ? -1 : 1) : Math.random() < .5 ? 1 : -1;     // from the side that leaves the next gate's gap open
        s.lashes.push({ side, t: 0, warn, len: 0 }); s.lash = Math.max(1.8, 2.4 - s.t * .1);
      }
      s.rocks.forEach(r => r.y += r.v * dt); s.rocks = s.rocks.filter(r => r.y < GH);
      s.bars.forEach(b => b.y += b.v * dt); s.bars = s.bars.filter(b => b.y < GH);
      for (const e of s.seekers) {
        if (e.y < 150) e.x += clamp((s.x - e.x) * 2.5, -(60 + s.t * 4), 60 + s.t * 4) * dt;
        else if (!e.set) {                                                // it commits to a column, veering clear of a gate's gap it would arrive with
          e.set = 1;
          for (const b of s.bars) if (Math.abs(arrives(b) - (py - e.y) / e.vy) < .5 && e.x + 8 > b.gap - 2 && e.x < b.gap + b.gw + 2) e.x = clamp(e.x + 4 < b.gap + b.gw / 2 ? b.gap - 10 : b.gap + b.gw + 2, 0, GW - 8);
        }
        e.y += e.vy * dt;
      }
      s.seekers = s.seekers.filter(e => e.y < GH);
      for (const L of s.lashes) { L.t += dt; const e = L.t - L.warn, R = GW / 2; L.len = e < 0 ? 0 : e < .3 ? e / .3 * R : e < .65 ? R : Math.max(0, 1 - (e - .65) / .35) * R; }
      s.lashes = s.lashes.filter(L => L.t < L.warn + 1.05);
      for (const r of s.rocks) { const hitX = r.x < s.x + 8 && r.x + r.w > s.x, hitY = r.y + 6 > py && r.y < py + 8; if (hitX && hitY) { s.why = 'STRUCK BY STATIC'; return false; } if (!r.n && hitY && r.x < s.x + 14 && r.x + r.w > s.x - 6) { r.n = 1; Audio_.sfx.blip(); s.near++; } }
      for (const b of s.bars) if (b.y + 3 > py && b.y < py + 8 && (s.x < b.gap || s.x + 8 > b.gap + b.gw)) { s.why = 'THE BAR TOOK YOU'; return false; }
      for (const e of s.seekers) if (e.x < s.x + 8 && e.x + 8 > s.x && e.y + 8 > py && e.y < py + 8) { s.why = 'A SEEKER FOUND YOU'; return false; }
      for (const L of s.lashes) if (L.len > 0 && (L.side > 0 ? s.x < L.len : s.x + 8 > GW - L.len)) { s.why = 'LASHED'; return false; }
      s.heat = s.t / s.goal; s.danger = od;
      if (s.t >= s.goal) return true;
    },
    draw: s => {
      px(s.x, GH - 16, 8, 8); px(s.x + 2, GH - 14, 4, 4, '#000'); px(s.x + 3, GH - 13, 2, 2);
      s.rocks.forEach(r => { px(r.x, r.y, r.w, 6); if (r.w > 5) px(r.x + 1, r.y + 1, r.w - 2, 4, '#000'); });
      s.bars.forEach(b => { px(0, b.y, b.gap, 3); px(b.gap + b.gw, b.y, GW - b.gap - b.gw, 3); });
      s.seekers.forEach(e => { px(e.x, e.y, 8, 8); px(e.x + 1, e.y + 1, 6, 6, '#000'); if (e.y >= 150 || Math.floor(s.t * 8) % 2) px(e.x + 3, e.y + 3, 2, 2); });
      for (const L of s.lashes) { if (L.len > 0) px(L.side > 0 ? 0 : GW - L.len, GH - 14, L.len, 4); else if (Math.floor(L.t * 14) % 2) px(L.side > 0 ? 0 : GW - 3, GH - 26, 3, 26); }
      text(`${Math.ceil(s.goal - s.t)}`, 5, '#888'); px(0, GH - 1, GW * (s.t / s.goal), 1);
    }
  };
  return DODGE;
});
