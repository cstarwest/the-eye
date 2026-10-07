'use strict';
// SIGIL: one of the gatekeeper's trials. See web/js/arena.js for the kit it receives.
Arena.define(({ GW, GH, px, text, sprite, burst, shake, flash, note, takeTaps }) => {
  // ---- 4. RECITE THE SIGIL: nothing to dodge and nowhere to run. The eye flashes a
  //      sequence of four runes, two to begin with (more at higher tiers), one longer
  //      and faster every round; recite it back, in order, before the timer drains.
  //      Three rounds. One wrong rune ends it.
  const RUNES = [
    ['...#...', '..###..', '.#.#.#.', '#..#..#', '...#...', '...#...', '...#...'],   // up: the trident
    ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'],   // right: the cross
    ['..###..', '.#...#.', '#..#..#', '#.###.#', '#..#..#', '.#...#.', '..###..'],   // down: the eye
    ['#######', '#.....#', '#.###.#', '#.#.#.#', '#.###.#', '#.....#', '#######'],   // left: the cell
  ];
  const RUNE_AT = [{ x: 80, y: 86 }, { x: 116, y: 122 }, { x: 80, y: 158 }, { x: 44, y: 122 }];   // centres: up, right, down, left
  const CENTRE = { x: 80, y: 122 };
  const SIGIL = {
    name: 'RECITE THE SIGIL', brief: 'REPEAT THE SEQUENCE. 3 ROUNDS.', help: ['WATCH · THEN TAP THE RUNES IN ORDER', 'WATCH · THEN ↑ → ↓ ← OR W D S A IN ORDER'],
    init: lvl => ({ seq: Array.from({ length: 1 + Math.min(2, Math.floor(lvl / 3)) }, () => Math.floor(Math.random() * 4)), round: 0, rounds: 3, phase: 'wait', t: .45, age: 0, i: 0, lit: -1, on: 0, show: .28, gap: .09, limit: 1.4, timer: 0, heat: 0, danger: false, look: CENTRE }),
    step: (s, dt) => {
      s.t -= dt; s.on -= dt; s.age += dt;
      if (s.on <= 0 && s.phase !== 'show') s.lit = -1;
      s.look = s.lit >= 0 ? RUNE_AT[s.lit] : CENTRE;
      const taps = takeTaps();
      if (s.phase === 'wait') {                                       // between rounds: one more rune, then the eye recites
        if (s.t <= 0) {
          s.seq.push(Math.floor(Math.random() * 4)); s.round++; s.i = 0; s.phase = 'show'; s.t = .35;
          s.show = Math.max(.15, .28 - s.round * .03 - s.lvl * .012); s.gap = Math.max(.05, .09 - s.round * .01); s.limit = Math.max(.7, 1.4 - s.round * .15 - s.lvl * .06);
          note(s, `ROUND ${s.round}`, .5);
        }
      } else if (s.phase === 'show') {
        if (s.t <= 0) {
          if (s.lit >= 0) { s.lit = -1; s.t = s.gap; s.i++; }
          else if (s.i < s.seq.length) { s.lit = s.seq[s.i]; s.t = s.show; Audio_.sfx.rune(s.lit); }
          else { s.phase = 'input'; s.i = 0; s.timer = s.limit; }
        }
      } else if (s.phase === 'input') {                               // you recite
        s.timer -= dt;
        if (s.timer <= 0) { s.why = 'TOO SLOW'; return false; }
        for (const d of taps) {
          s.lit = d; s.on = .16;
          if (d !== s.seq[s.i]) { s.on = 9; s.why = 'WRONG RUNE'; return false; }
          s.i++; s.timer = s.limit; Audio_.sfx.rune(d); burst(RUNE_AT[d].x, RUNE_AT[d].y, 6, 40);
          if (s.i >= s.seq.length) {
            if (s.round >= s.rounds) { flash(); return true; }
            s.phase = 'wait'; s.t = .45; flash(); shake(.15); Audio_.sfx.smash(); buzz(15); break;
          }
        }
      }
      s.heat = (s.round - 1) / s.rounds + (s.phase === 'input' ? .1 : 0);
      s.danger = s.round >= s.rounds || (s.phase === 'input' && s.timer < s.limit * .35);
    },
    draw: s => {
      const L = s.lit >= 0 ? RUNE_AT[s.lit] : null;
      sprite(['....#####....', '..##.....##..', '.#.........#.', '#...........#', '.#.........#.', '..##.....##..', '....#####....'], CENTRE.x - 6, CENTRE.y - 3);
      px(CENTRE.x - 1 + (L ? Math.sign(L.x - CENTRE.x) * 3 : 0), CENTRE.y - 1 + (L ? Math.sign(L.y - CENTRE.y) : 0), 3, 3);     // the pupil follows the lit rune
      RUNES.forEach((r, i) => {
        const c = RUNE_AT[i], lit = s.lit === i;
        if (lit) px(c.x - 8, c.y - 8, 17, 17); else { px(c.x - 8, c.y - 8, 17, 1); px(c.x - 8, c.y + 8, 17, 1); px(c.x - 8, c.y - 8, 1, 17); px(c.x + 8, c.y - 8, 1, 17); }
        sprite(r, c.x - 3, c.y - 3, lit ? '#000' : '#fff');
      });
      for (let i = 0; i < s.seq.length; i++) px(CENTRE.x - s.seq.length * 2 + i * 4, 176, 3, 3, i < s.i ? '#fff' : '#444');
      if (s.phase === 'input') { px(0, GH - 2, Math.round(GW * s.timer / s.limit), 2); text('RECITE', 14, Math.floor(s.age * 6) % 2 ? '#fff' : '#888'); }
      else if (s.phase === 'show') text('WATCH', 14, '#888');
      text(`ROUND ${Math.max(1, s.round)}/${s.rounds}`, 5, '#888');
    }
  };
  return SIGIL;
});
