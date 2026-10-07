'use strict';
// SHMUP: one of the gatekeeper's trials. See web/js/arena.js for the kit it receives.
Arena.define(({ GW, GH, px, text, sprite, burst, shake, flash, note, paddleInput, firing }) => {
  // ---- 2. PURGE THE SWARM: watchers sweep in lines, dive at you and aim their shots,
  //      thicker and faster with every kill; for the first second they only approach.
  //      Twin cannon at half the quota; at the quota, the Warden: a great eye that
  //      strafes faster as it is hurt, fires spreads at you and calls escorts. Three
  //      lives. Six watchers and the Warden take a few seconds.
  const FOE = [['.#.....#.', '..#...#..', '.#######.', '##.###.##', '#########', '#.#...#.#', '#.#...#.#', '...#.#...'], ['.#.....#.', '#.#...#.#', '.#######.', '##.###.##', '#########', '..#...#..', '.#.....#.', '#.......#']];
  const SHIP = ['...##...', '...##...', '..####..', '.######.', '##.##.##', '#..##..#'];
  const WARDEN = Array.from({ length: 13 }, (_, j) => Array.from({ length: 25 }, (_, i) => { const dx = (i - 12) / 12.5, dy = (j - 6) / 6.5, r = dx * dx + dy * dy; return r <= 1 && !(r > .46 && r < .64) ? '#' : '.'; }).join(''));
  const SHMUP = {
    name: 'PURGE THE SWARM', brief: lvl => `DESTROY ${6 + Math.floor(lvl / 4)} WATCHERS. THEN THE WARDEN.`, help: ['DRAG TO MOVE · HOLD TO FIRE', '← → MOVE · SPACE FIRE'],
    init: lvl => ({ x: 76, shots: [], foes: [], eshots: [], kills: 0, need: 6 + Math.floor(lvl / 4), t: 0, cd: 0, spawn: .2, lives: 3, inv: 0, combo: 0, comboT: 0, twin: false, boss: null, heat: 0, danger: false }),
    step: (s, dt) => {
      s.t += dt; s.cd -= dt; s.inv -= dt; s.spawn -= dt; s.comboT -= dt; s.x = paddleInput(s.x, 8, 210, dt);
      if (firing() && s.cd <= 0) { if (s.twin) s.shots.push({ x: s.x + 1, y: GH - 22 }, { x: s.x + 6, y: GH - 22 }); else s.shots.push({ x: s.x + 3.5, y: GH - 22 }); s.cd = s.twin ? .16 : .18; Audio_.sfx.shoot(); }
      const k = s.kills, prog = Math.min(1, k / s.need), pace = 1 + s.lvl * .025, armed = s.t > 1.2;
      let B = s.boss;
      if (!B && s.spawn <= 0) {
        const n = Math.min(4, 2 + Math.floor(k / 3)), line = Math.random() < .35 + prog * .3, dir = Math.random() < .5 ? -1 : 1;
        for (let i = 0; i < n; i++) s.foes.push(line ? { x: dir > 0 ? -10 - i * 14 : GW + 1 + i * 14, y: rnd(-6, 10), vx: dir * (55 + k * 6) * pace, f: i, dive: 0, line: 1 } : { x: rnd(2, GW - 11), y: -10 - i * 14, vx: rnd(-1, 1) * (40 + k * 6) * pace, f: Math.random() * 10, dive: 0 });
        s.spawn = Math.max(.28, .6 - k * .05) / (1 + s.lvl * .02);
      }
      s.shots.forEach(p => p.y -= 250 * dt); s.shots = s.shots.filter(p => p.y > -4);
      for (const f of s.foes) {
        if (!f.dive && armed && f.y > 30 && Math.random() < .003 + prog * .01) { f.dive = 1; Audio_.sfx.blip(); }
        if (f.dive) { f.y += (120 + k * 6) * pace * dt; f.x += clamp((s.x - f.x) * 3, -80, 80) * dt; }
        else {
          f.y += (40 + k * 5) * pace * dt; f.x += f.vx * dt;
          if (f.line && f.x > 0 && f.x < GW - 9) f.line = 0;
          if (!f.line && (f.x < 0 || f.x > GW - 9)) { f.x = clamp(f.x, 0, GW - 9); f.vx *= -1; }
          if (armed && Math.random() < .006 + k * .0015) s.eshots.push({ x: f.x + 4, y: f.y + 8, vx: clamp((s.x - f.x) / 1.5, -65, 65), vy: (110 + k * 5) * pace });
        }
      }
      s.eshots.forEach(p => { p.y += p.vy * dt; p.x += p.vx * dt; }); s.eshots = s.eshots.filter(p => p.y < GH && p.x > -3 && p.x < GW + 3);
      let kills = 0;
      for (const f of s.foes) for (const p of s.shots) if (!f.d && p.y > -1 && p.x > f.x - 1 && p.x < f.x + 10 && p.y > f.y && p.y < f.y + 8) { f.d = 1; p.y = -99; kills++; burst(f.x + 4, f.y + 4, 8); Audio_.sfx.kill(); }
      if (kills) {
        s.kills += kills; s.combo = s.comboT > 0 ? s.combo + kills : kills; s.comboT = .55; if (s.combo >= 3) shake(.12);
        if (!s.twin && s.kills >= s.need / 2) { s.twin = true; note(s, 'TWIN CANNON'); Audio_.sfx.smash(); }
      }
      s.foes = s.foes.filter(f => !f.d && f.y < GH && f.x > -100 && f.x < GW + 100);
      if (!B && s.kills >= s.need) { const hp = 5 + Math.floor(s.lvl / 4); B = s.boss = { x: 68, y: -16, hp, max: hp, t: 0, cd: .9, hurt: 0 }; s.foes = []; s.eshots = []; note(s, 'THE WARDEN COMES', 1); Audio_.sfx.thud(); shake(.4); buzz([40, 40, 80]); }
      if (B) {
        B.t += dt; B.cd -= dt; B.hurt -= dt;
        const rage = 1 - B.hp / B.max;
        if (B.y < 18) B.y += 40 * dt; else { B.x = 68 + Math.sin(B.t * (1.3 + rage * 1.6)) * 62 + Math.sin(B.t * 3.3) * 6; B.y = 18 + Math.sin(B.t * .8) * 7; }
        if (B.y >= 8 && B.cd <= 0) {
          const cx = B.x + 12, cy = B.y + 12, aim = clamp((s.x + 4 - cx) / 1.4, -60, 60);
          for (const o of [-48, 0, 48]) s.eshots.push({ x: cx, y: cy, vx: aim + o, vy: (105 + rage * 35) * pace + s.lvl * 6 });
          if (Math.random() < .5) s.foes.push({ x: cx - 4, y: cy, vx: rnd(-1, 1) * 50, f: 0, dive: 0 });
          B.cd = Math.max(.4, 1 - rage * .55) / pace; Audio_.sfx.shoot();
        }
        for (const p of s.shots) if (p.y > -1 && p.y > B.y && p.y < B.y + 13 && p.x > B.x && p.x < B.x + 25) { p.y = -99; B.hp--; B.hurt = .07; burst(p.x, B.y + 13, 3); Audio_.sfx.hit(); }
        if (B.hp <= 0) { burst(B.x + 12, B.y + 6, 50, 110); shake(.6); flash(); return true; }
      }
      const hit = s.eshots.some(p => p.x > s.x - 1 && p.x < s.x + 9 && p.y > GH - 20 && p.y < GH - 12) || s.foes.some(f => f.y + 8 > GH - 20 && f.y < GH - 12 && f.x < s.x + 8 && f.x + 9 > s.x);
      if (hit && s.inv <= 0) { s.lives--; s.inv = 1.4; flash(); shake(.3); Audio_.sfx.hurt(); burst(s.x + 4, GH - 15, 12); s.eshots = []; if (!s.lives) { s.why = B ? 'THE WARDEN STANDS' : 'TAKEN BY THE SWARM'; return false; } }
      s.heat = B ? .7 + .3 * (1 - B.hp / B.max) : prog * .65; s.danger = s.lives === 1 || (!!B && B.hp <= 2);
    },
    draw: s => {
      if (s.inv <= 0 || Math.floor(s.t * 14) % 2) sprite(SHIP, s.x, GH - 20);
      s.shots.forEach(p => px(p.x, p.y, 1, 4)); s.eshots.forEach(p => px(p.x, p.y, 2, 3));
      s.foes.forEach(f => sprite(FOE[Math.floor(s.t * (f.dive ? 12 : 4) + f.f) % 2], f.x, f.y));
      const B = s.boss;
      if (B) {
        const inv = B.hurt > 0; if (inv) px(B.x - 1, B.y - 1, 27, 15); sprite(WARDEN, B.x, B.y, inv ? '#000' : '#fff');
        px(B.x + 11 + clamp((s.x - B.x - 8) / 20, -3, 3), B.y + 5, 3, 3, inv ? '#fff' : '#000');     // it looks at you
        px(28, 3, 104, 1, '#444'); px(28, 2, Math.round(104 * B.hp / B.max), 3);
      }
      for (let i = 0; i < s.lives; i++) px(4 + i * 6, 4, 4, 4);
      if (!B) text(`${s.kills}/${s.need}`, 5, '#888');
      if (s.comboT > 0 && s.combo >= 2) text(`X${s.combo}`, 14, '#fff', 2);
    }
  };
  return SHMUP;
});
