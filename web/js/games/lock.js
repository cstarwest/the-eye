'use strict';
// LOCK: a timing trial, rather than movement, shooting or memory. All three slots
// stay visible: read the next one while the current tumbler clicks into place.
Arena.define(({ GW, GH, px, text, sprite, burst, shake, flash, note, takePresses }) => {
  const LEFT = 14, RIGHT = GW - 14, ROW_Y = [94, 132, 170];
  const speed = s => (78 + s.lvl * 3) * (1 + s.row * .2);
  const LOCK = {
    name: 'PICK THE LOCK', brief: 'TIME THREE TUMBLERS. TWO STRIKES.',
    help: ['TAP WHEN THE NEEDLE IS IN THE SLOT', 'SPACE / ANY ARROW / WASD · HIT THE SLOT'],
    init: lvl => ({
      lvl, tumblers: Array.from({ length: 3 }, (_, row) => ({ target: Math.round(rnd(42, 118)), width: 28 - lvl * .8 - row * 3, set: false })),
      row: 0, picked: 0, needle: LEFT, dir: 1, strikes: 0, phase: 'ready', pause: .55,
      age: 0, time: 10 - lvl * .12, limit: 10 - lvl * .12, pulse: 0, open: 0,
      heat: 0, danger: false, look: { x: LEFT, y: ROW_Y[0] }, result: undefined,
    }),
    step: (s, dt) => {
      // A queued Space/arrow/touch press survives release between frames. A held
      // key, pointer drag or multiple presses in one frame is only one pick.
      const pressed = takePresses() > 0;
      if (s.result !== undefined) return s.result;
      s.age += dt; s.pulse = Math.max(0, s.pulse - dt);
      if (s.phase === 'opening') {
        s.open = Math.min(1, s.open + dt / .48);
        if (s.open >= 1) return s.result = true;
        return;
      }
      s.time = Math.max(0, s.time - dt);
      if (s.time <= 0) { s.why = 'THE LOCK SEALED'; return s.result = false; }
      s.heat = Math.min(1, s.picked / 3 * .7 + (1 - s.time / s.limit) * .3);
      s.danger = s.strikes > 0 || s.row === 2 || s.time < 2;
      if (s.phase !== 'sweep') {
        // Input during the opening beat or hit-stop is consumed, never buffered.
        s.pause -= dt;
        if (s.pause <= 0) {
          if (s.phase === 'caught') { s.row++; s.dir *= -1; s.needle = s.dir > 0 ? LEFT : RIGHT; }
          s.phase = 'sweep';
        }
      } else if (pressed) {
        const tumbler = s.tumblers[s.row], x = Math.round(s.needle);
        // Judge the last rendered position, before advancing this frame. Even the
        // fastest tier leaves more than two 50ms frames inside its narrowest slot.
        if (Math.abs(x - tumbler.target) <= tumbler.width / 2) {
          tumbler.set = true; tumbler.hit = x; s.picked++; s.pulse = .25;
          burst(x, ROW_Y[s.row], 12, 55); shake(.12); Audio_.sfx.clack(); buzz(15);
          if (s.picked === s.tumblers.length) {
            s.phase = 'opening'; s.heat = 1; s.danger = false;
            flash(); shake(.35); burst(GW / 2, 53, 30, 90); Audio_.sfx.smash();
          } else { s.phase = 'caught'; s.pause = .32; }
        } else {
          s.strikes++; s.pulse = .25;
          shake(.25); Audio_.sfx.hit(); burst(x, ROW_Y[s.row], 6, 35); buzz(35);
          if (s.strikes >= 2) { s.why = 'LOCK JAMMED'; return s.result = false; }
          s.phase = 'recover'; s.pause = .35; s.danger = true; note(s, 'ONE STRIKE LEFT', .65);
        }
      } else {
        s.needle += s.dir * speed(s) * dt;
        // Reflect the overshoot, rather than throwing away travel at either edge.
        while (s.needle < LEFT || s.needle > RIGHT) {
          if (s.needle > RIGHT) { s.needle = RIGHT * 2 - s.needle; s.dir = -1; }
          else { s.needle = LEFT * 2 - s.needle; s.dir = 1; }
        }
      }
      s.look = { x: s.needle, y: ROW_Y[s.row] };
    },
    draw: s => {
      text(`${s.picked}/3 SET`, 5);
      text(s.phase === 'opening' ? 'UNLOCKED' : 'TAP IN THE SLOT', 17);
      // A shackle lifts, then the lock body splits on the final satisfying click.
      const lift = Math.round(s.open * 13), split = Math.round(s.open * 11);
      px(70, 32 - lift, 20, 3); px(68, 35 - lift, 3, 13); px(89, 35 - lift, 3, 13 - lift);
      px(63 - split, 45, 17, 25); px(80 + split, 45, 17, 25);
      px(77 - split, 53, 3, 5, '#000'); px(80 + split, 53, 3, 5, '#000');
      px(79 - split, 58, 1, 5, '#000'); px(80 + split, 58, 1, 5, '#000');
      s.tumblers.forEach((tumbler, row) => {
        const y = ROW_Y[row], active = row === s.row && s.phase !== 'opening', lo = Math.ceil(tumbler.target - tumbler.width / 2), hi = Math.floor(tumbler.target + tumbler.width / 2);
        if (active || tumbler.set) px(LEFT, y, RIGHT - LEFT + 1, 1);
        else for (let x = LEFT; x <= RIGHT; x += 4) px(x, y, 1, 1);
        px(LEFT - 3, y - 4, 1, 9); px(RIGHT + 3, y - 4, 1, 9);
        if (tumbler.set) {
          px(lo, y - 8, hi - lo + 1, 17);
          sprite(['....#', '...#.', '#.#..', '.#...'], tumbler.target - 2, y - 2, '#000');
        } else {
          px(lo, y - 8, hi - lo + 1, 17);
          if (!active) px(lo + 1, y - 7, hi - lo - 1, 15, '#000');
          if (active) {
            const x = Math.round(s.needle);
            // A black core remains legible while the white needle crosses white.
            px(x - 1, y - 13, 3, 27); px(x, y - 8, 1, 17, '#000');
            px(x - 3, y - 16, 7, 2); px(x - 2, y - 14, 5, 1);
            if (s.pulse > 0 && s.phase === 'recover') { px(x - 5, y - 5, 2, 2); px(x + 4, y + 4, 2, 2); }
          }
        }
      });
      text(s.phase === 'opening' ? 'ACCESS GRANTED' : `${Math.ceil(s.time)} SECONDS`, 213);
      // Two fuse marks. A crossed-out fuse is a strike, without relying on colour.
      for (let i = 0; i < 2; i++) {
        const x = 71 + i * 13;
        if (i < s.strikes) sprite(['#...#', '.#.#.', '..#..', '.#.#.', '#...#'], x, 225);
        else { px(x, 225, 5, 5); px(x + 1, 226, 3, 3, '#000'); }
      }
      px(0, GH - 2, Math.round(GW * s.time / s.limit), 2);
    },
  };
  return LOCK;
});
