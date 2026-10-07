'use strict';
// BRICKS: one of the gatekeeper's trials. See web/js/arena.js for the kit it receives.
Arena.define(({ GW, GH, px, text, burst, shake, flash, note, setSpeed, paddleInput }) => {
  // ---- 1. BREACH THE WALL: a wall shaped like an eye, close enough to touch, and it is
  //      coming for you. It is breached once enough of it has fallen (six bricks of
  //      twenty-six, a few more at higher tiers): the iris takes two hits, the pupil
  //      three, and the pupil fires glare that stuns the paddle. The wall descends a row
  //      at a time, sooner each time, and takes you if it reaches the paddle; a second
  //      ball is served almost at once; the balls quicken with every second and every
  //      return; the paddle shrinks as the wall thins. Three balls. A few seconds.
  const BRICKS = {
    name: 'BREACH THE WALL', brief: lvl => `BREAK ${6 + Math.floor(lvl / 3)} BRICKS. THREE BALLS.`, help: ['DRAG TO MOVE', '← → OR A D TO MOVE'],
    init: lvl => {
      const b = [], shape = ['..####..', '.######.', '##.##.##', '.######.', '..####..'], y0 = 106 + (lvl >= 5 ? 7 : 0);
      shape.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === '#') {
        const pupil = r === 2 && (c === 3 || c === 4), iris = (r === 1 || r === 3) && (c === 3 || c === 4);
        b.push({ x: 5 + c * 19, y: y0 + r * 7, w: 17, h: 6, hp: pupil ? 3 : iris ? 2 : 1, pupil });
      } });
      const adv = 2.2 - lvl * .08;
      return { px: 65, pw: 30, balls: [], b, total: b.length, need: 6 + Math.floor(lvl / 3), lives: 3, t: 0, serve: .6, boost: 1, adv, advAt: adv, advN: 0, bolts: [], glare: 1.4, stun: 0, split: false, heat: 0, danger: false };
    },
    step: (s, dt) => {
      s.t += dt; s.stun -= dt;
      const cleared = 1 - s.b.filter(k => k.hp).length / s.total;
      s.pw = Math.round(clamp(30 - 10 * cleared - s.lvl, 16, 30));
      s.px = s.stun > 0 ? clamp(s.px, 0, GW - s.pw) : paddleInput(s.px, s.pw, 240, dt);
      // the wall advances, sooner each time
      s.adv -= dt;
      if (s.adv <= 0) { s.b.forEach(k => k.y += 7); s.advAt = Math.max(1 - s.lvl * .03, s.advAt - .3); s.adv = s.advAt; if (s.advN++ < 2) note(s, 'THE WALL ADVANCES', .7); Audio_.sfx.thud(); shake(.25); buzz(20); }
      if (s.b.some(k => k.hp && k.y + k.h >= GH - 14)) { s.why = 'THE WALL TOOK YOU'; return false; }
      // serve
      if (s.serve > 0) { s.serve -= dt; if (s.serve <= 0) s.balls.push({ x: s.px + s.pw / 2, y: GH - 16, vx: Math.random() < .5 ? -60 : 60, vy: -105 }); }
      // the pupil glares
      const pupils = s.b.filter(k => k.pupil && k.hp);
      if (pupils.length && s.balls.length && s.t > 1.5) {
        s.glare -= dt;
        if (s.glare <= 0) { s.bolts.push({ x: 79, y: pupils[0].y + 8, v: 95 + s.lvl * 8 }); s.glare = Math.max(.9, rnd(1.6, 2.8) - s.lvl * .12); Audio_.sfx.shoot(); }
      }
      s.bolts.forEach(o => o.y += o.v * dt);
      for (const o of s.bolts) if (o.y > GH - 14 && o.y < GH - 6 && o.x + 2 > s.px && o.x < s.px + s.pw) { o.y = GH + 9; s.stun = .8; flash(); shake(.3); Audio_.sfx.hurt(); burst(o.x, GH - 10, 8); }
      s.bolts = s.bolts.filter(o => o.y < GH + 8);
      // the balls, in sub-steps so a fast ball cannot pass through a brick or the paddle
      const speed = 150 * (1 + Math.min(.4, s.t / 16)) * s.boost * (1 + s.lvl * .05);
      for (const ball of s.balls) {
        setSpeed(ball, speed);
        const n = Math.ceil(speed * dt / 3), h = dt / n;
        for (let i = 0; i < n && !ball.lost; i++) {
          ball.x += ball.vx * h; ball.y += ball.vy * h;
          if (ball.x < 2) { ball.x = 2; ball.vx = Math.abs(ball.vx); Audio_.sfx.bounce(); } if (ball.x > GW - 2) { ball.x = GW - 2; ball.vx = -Math.abs(ball.vx); Audio_.sfx.bounce(); }
          if (ball.y < 2) { ball.y = 2; ball.vy = Math.abs(ball.vy); Audio_.sfx.bounce(); }
          if (ball.vy > 0 && ball.y > GH - 14 && ball.y < GH - 8 && ball.x > s.px - 2 && ball.x < s.px + s.pw + 2) {
            ball.vy = -Math.abs(ball.vy); ball.vx += ((ball.x - s.px) / s.pw - .5) * 160;
            const m = Math.hypot(ball.vx, ball.vy); if (Math.abs(ball.vy) < m * .35) { ball.vy = -m * .35; ball.vx = Math.sign(ball.vx || 1) * m * Math.sqrt(1 - .35 * .35); }
            s.boost = Math.min(1.2, s.boost * 1.02); Audio_.sfx.blip();
          }
          if (ball.y > GH + 4) { ball.lost = true; break; }
          for (const k of s.b) if (k.hp && ball.x > k.x - 1 && ball.x < k.x + k.w + 1 && ball.y > k.y - 1 && ball.y < k.y + k.h + 1) {
            k.hp--; burst(ball.x, ball.y, k.hp ? 4 : 10); k.hp ? Audio_.sfx.hit() : Audio_.sfx.smash(); if (!k.hp && k.pupil) { shake(.3); flash(); }
            const fromSide = ball.x < k.x || ball.x > k.x + k.w; if (fromSide) ball.vx *= -1; else ball.vy *= -1; break;
          }
        }
      }
      if (s.balls.some(b => b.lost)) {
        s.balls = s.balls.filter(b => !b.lost);
        if (!s.balls.length) { s.lives--; Audio_.sfx.hurt(); flash(); shake(.3); if (!s.lives) { s.why = 'OUT OF BALLS'; return false; } s.serve = .6; s.boost = 1; }
      }
      // the second ball, almost at once
      if (!s.split && (cleared >= .08 || s.t > 1.6) && s.balls.length) { s.split = true; const b0 = s.balls[0]; s.balls.push({ x: s.px + s.pw / 2, y: GH - 16, vx: -Math.sign(b0.vx || 1) * 70, vy: -100 }); note(s, 'SECOND BALL'); Audio_.sfx.smash(); }
      const low = Math.max(0, ...s.b.filter(k => k.hp).map(k => k.y + k.h)), broken = s.total - s.b.filter(k => k.hp).length;
      s.heat = broken / s.need * .8 + (s.lives === 1 ? .2 : 0); s.danger = s.lives === 1 || s.need - broken <= 3 || low >= GH - 14 - 21;
      if (broken >= s.need) { s.b.filter(k => k.hp).forEach(k => burst(k.x + k.w / 2, k.y + 3, 6, 80)); shake(.5); return true; }
    },
    draw: s => {
      for (const k of s.b) if (k.hp) { px(k.x, k.y, k.w, k.h); if (k.hp >= 2) px(k.x + 2, k.y + 2, k.w - 4, k.h - 4, '#000'); if (k.hp === 3) px(k.x + 7, k.y + 2, 3, 2); }
      if (s.stun > 0 && Math.floor(s.t * 20) % 2) { for (let x = s.px; x < s.px + s.pw; x += 4) px(x, GH - 10, 2, 3); }
      else { px(s.px, GH - 10, s.pw, 3); px(s.px + 2, GH - 7, s.pw - 4, 1); }
      if (s.serve > 0) px(s.px + s.pw / 2 - 1, GH - 17, 3, 3);
      for (const b of s.balls) px(b.x - 1, b.y - 1, 3, 3);
      for (const o of s.bolts) { px(o.x, o.y, 2, 5); px(o.x, o.y + 7, 2, 2); }
      for (let i = 0; i < s.lives; i++) px(4 + i * 6, 4, 4, 4);
      text(s.serve > 0 ? 'SERVE' : `${Math.max(0, s.need - (s.total - s.b.filter(k => k.hp).length))} TO GO`, 5, '#888');
      px(118, 6, Math.round(38 * (s.adv / s.advAt)), 2, '#888');                 // until the wall advances
    }
  };
  return BRICKS;
});
