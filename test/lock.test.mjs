import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const arenaSource = await readFile(new URL('web/js/arena.js', root), 'utf8');
const files = ['bricks', 'shmup', 'dodge', 'sigil', 'lock'];
const gameSources = await Promise.all(files.map(name => readFile(new URL(`web/js/games/${name}.js`, root), 'utf8')));

// Drive production arena event handlers and the real game. No substitute input
// implementation and no state teleporting are used by the winning autopilot.
function load(seed = 1, storage = new Map()) {
  const events = new Map(), stageEvents = new Map(), calls = [], pixels = [];
  const math = Object.create(Math);
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const classes = new Set(['on']);
  const stage = { classList: {
    contains: c => classes.has(c), add: (...cs) => cs.forEach(c => classes.add(c)),
    remove: (...cs) => cs.forEach(c => classes.delete(c)), toggle() {},
  }, addEventListener: (type, handler) => stageEvents.set(type, handler) };
  const context = { fillStyle: '#000', fillRect(x, y, w, h) { pixels.push({ x, y, w, h, colour: this.fillStyle }); } };
  const canvas = { style: {}, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 160, height: 240 }) };
  const els = { stage, gc: canvas, gtitle: { style: {} }, ghelp: { style: {} } };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const sandbox = {
    Math: math, $: id => els[id], clamp, rnd: (lo, hi) => lo + math.random() * (hi - lo), pick: xs => xs[Math.floor(math.random() * xs.length)],
    addEventListener: (type, handler) => events.set(type, handler),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    Audio_: { sfx: new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) }), setDanger() {}, setIntensity() {} },
    Eye: { look() {} }, CONFIG: { reducedMotion: true }, buzz: (...args) => calls.push(['buzz', ...args]),
    innerWidth: 1280, innerHeight: 800, matchMedia: () => ({ matches: false }), wait: async () => {},
    performance: { now: () => 1000 }, requestAnimationFrame() {},
  };
  const arena = runInNewContext(`${arenaSource}\n${gameSources.join('\n')}\nArena;`, sandbox);
  const event = (type, data = {}) => events.get(type)?.({ preventDefault() {}, ...data });
  const key = (key, repeat = false) => { event('keydown', { key, repeat }); event('keyup', { key }); };
  const touch = (x = 80, y = 120) => { stageEvents.get('pointerdown')({ clientX: x, clientY: y }); event('pointerup'); };
  const game = arena.byName('lock');
  return { arena, game, key, touch, event, stageEvents, calls, pixels, storage, init: (lvl = 0) => game.init(lvl) };
}

const inside = s => Math.abs(Math.round(s.needle) - s.tumblers[s.row].target) <= s.tumblers[s.row].width / 2;
function advance(h, s, until, dt = 1 / 60) {
  for (let frame = 0; frame < 1000; frame++) {
    if (until(s)) return;
    const result = h.game.step(s, dt);
    assert.equal(result, undefined, `trial unexpectedly ended: ${s.why}`);
  }
  assert.fail('condition was never reached');
}
function ready(h, s, dt = 1 / 60) { advance(h, s, st => st.phase === 'sweep' && inside(st), dt); }

for (const dt of [1 / 60, 1 / 30, .05]) {
  test(`lock: all ten tiers win through actual queued key presses at dt ${dt}`, () => {
    for (let tier = 0; tier <= 9; tier++) for (const seed of [1, 73, 1007, 77777]) {
      const h = load(seed), s = h.init(tier);
      let result, frames = 0;
      while (result === undefined && frames++ < Math.ceil(12 / dt)) {
        if (s.phase === 'sweep' && inside(s)) h.key(' ');
        result = h.game.step(s, dt);
      }
      assert.equal(result, true, `tier ${tier}, seed ${seed}: ${s.why}`);
      assert.equal(s.picked, 3); assert.equal(s.strikes, 0);
      assert.ok(s.tumblers.every(t => t.set));
      assert.equal(s.open, 1); assert.ok(s.age < 10);
      assert.equal(h.calls.filter(([name]) => name === 'clack').length, 3);
      assert.equal(h.calls.filter(([name]) => name === 'smash').length, 1);
    }
  });
}

test('lock: every keyboard hint and every touch quadrant picks a tumbler', () => {
  const inputs = [' ', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'w', 'd', 's', 'a', 'W', 'D', 'S', 'A'];
  for (const key of inputs) {
    const h = load(), s = h.init(); ready(h, s);
    h.key(key); h.game.step(s, .05);
    assert.equal(s.picked, 1, `${JSON.stringify(key)} must work even when released before the frame`);
  }
  for (const [x, y] of [[80, 20], [150, 120], [80, 230], [10, 120]]) {
    const h = load(), s = h.init(); ready(h, s);
    h.touch(x, y); h.game.step(s, .05); assert.equal(s.picked, 1, `touch at ${x}, ${y}`);
  }
});

test('lock: no input reaches an honest timeout loss at every tier', () => {
  for (let tier = 0; tier <= 9; tier++) {
    const h = load(), s = h.init(tier);
    let result; for (let frame = 0; frame < 250 && result === undefined; frame++) result = h.game.step(s, .05);
    assert.equal(result, false); assert.equal(s.why, 'THE LOCK SEALED'); assert.equal(s.picked, 0);
    assert.equal(s.time, 0); assert.ok(s.age >= s.limit && s.age < s.limit + .051);
  }
});

test('lock: two actual mistimed presses jam the lock; the first is recoverable', () => {
  const h = load(), s = h.init(); advance(h, s, st => st.phase === 'sweep');
  h.key(' '); assert.equal(h.game.step(s, .016), undefined);
  assert.equal(s.strikes, 1); assert.equal(s.phase, 'recover'); assert.equal(s.danger, true);
  advance(h, s, st => st.phase === 'sweep');
  h.touch(); assert.equal(h.game.step(s, .016), false);
  assert.equal(s.strikes, 2); assert.equal(s.why, 'LOCK JAMMED'); assert.equal(s.picked, 0);
});

test('lock: one strike can still recover into a real win', () => {
  const h = load(), s = h.init(); advance(h, s, st => st.phase === 'sweep');
  h.key(' '); h.game.step(s, .016);
  let result;
  for (let frame = 0; frame < 500 && result === undefined; frame++) {
    if (s.phase === 'sweep' && inside(s)) h.touch();
    result = h.game.step(s, 1 / 60);
  }
  assert.equal(result, true); assert.equal(s.strikes, 1); assert.equal(s.picked, 3);
});

test('lock: holds, auto-repeat, rapid duplicate taps and transition inputs cannot chain picks', () => {
  const h = load(), s = h.init(); ready(h, s);
  h.event('keydown', { key: ' ' }); h.game.step(s, .016);
  assert.equal(s.picked, 1);
  advance(h, s, st => st.row === 1 && st.phase === 'sweep');
  for (let i = 0; i < 40; i++) { h.event('keydown', { key: ' ', repeat: true }); h.game.step(s, .016); }
  assert.equal(s.picked, 1); assert.equal(s.strikes, 0);
  h.event('keyup', { key: ' ' }); ready(h, s);
  h.key(' '); h.key('ArrowUp'); h.touch(); h.game.step(s, .016);
  assert.equal(s.picked, 2, 'a batch within one frame is one attempt');
  h.key(' '); h.game.step(s, .016);
  advance(h, s, st => st.row === 2 && st.phase === 'sweep');
  assert.equal(s.picked, 2); assert.equal(s.strikes, 0, 'hit-stop taps cannot carry into the next row');
});

test('lock: presses before play, pointer movement and held input never create an attempt', () => {
  const h = load(), s = h.init();
  h.key(' '); h.touch(); h.game.step(s, .016);
  advance(h, s, st => st.phase === 'sweep');
  assert.equal(s.picked, 0); assert.equal(s.strikes, 0);
  ready(h, s); h.stageEvents.get('pointermove')({ clientX: 80, clientY: 120 }); h.game.step(s, .016);
  assert.equal(s.picked, 0);
});

test('lock: slots narrow and sweep speeds rise gradually by tier and tumbler', () => {
  const h = load(), easy = h.init(0), hard = h.init(9);
  assert.ok(hard.limit < easy.limit && hard.limit > 8);
  for (let row = 0; row < 3; row++) {
    assert.ok(hard.tumblers[row].width < easy.tumblers[row].width);
    assert.ok(hard.tumblers[row].width >= 14);
    if (row) assert.ok(easy.tumblers[row].width < easy.tumblers[row - 1].width);
  }
  for (const s of [easy, hard]) advance(h, s, st => st.phase === 'sweep');
  const before = [easy.needle, hard.needle];
  h.game.step(easy, .05); h.game.step(hard, .05);
  assert.ok(hard.needle - before[1] > easy.needle - before[0]);
  let previousSpeed = 0;
  for (let row = 0; row < 3; row++) {
    advance(h, easy, st => st.row === row && st.phase === 'sweep');
    const x = easy.needle; h.game.step(easy, .05);
    const velocity = Math.abs(easy.needle - x) / .05;
    assert.ok(velocity > previousSpeed); previousSpeed = velocity;
    ready(h, easy); h.key(' '); h.game.step(easy, .016);
  }
});

test('lock: a bounced needle stays in bounds, and taps judge the visible pre-frame position', () => {
  const h = load(), s = h.init(9); advance(h, s, st => st.phase === 'sweep');
  let reversed = false;
  for (let i = 0; i < 80; i++) {
    const dir = s.dir; h.game.step(s, .05);
    assert.ok(s.needle >= 14 && s.needle <= 146);
    if (dir !== s.dir) reversed = true;
  }
  assert.equal(reversed, true);
  ready(h, s, .05); const x = Math.round(s.needle);
  h.key(' '); h.game.step(s, .05);
  assert.equal(s.tumblers[0].hit, x); assert.equal(s.picked, 1);
});

test('arena: one-button queue preserves sigil directions and clears on read, blur and new run', async () => {
  const h = load();
  h.key(' '); assert.equal(h.arena.kit.takeTaps().length, 0, 'Space must not become a sigil rune');
  assert.equal(h.arena.kit.takePresses(), 1); assert.equal(h.arena.kit.takePresses(), 0);
  for (const key of ['ArrowUp', 'd', 'S', 'ArrowLeft']) h.key(key);
  assert.deepEqual(Array.from(h.arena.kit.takeTaps()), [0, 1, 2, 3]);
  assert.equal(h.arena.kit.takePresses(), 4, 'reading directional taps must not eat the independent queue');
  h.key(' '); h.event('blur'); assert.equal(h.arena.kit.takePresses(), 0);
  h.key(' '); void h.arena.run(h.game, 0); assert.equal(h.arena.kit.takePresses(), 0);
  // Let the async countdown finish; requestAnimationFrame is deliberately idle.
  for (let i = 0; i < 6; i++) await Promise.resolve();
});

test('arena: fifth game participates in selection, independent persistent tiers, and loss relief', async () => {
  const h = load();
  assert.deepEqual(Array.from(h.arena.GAMES, g => g.name), ['BREACH THE WALL', 'PURGE THE SWARM', 'OUTRUN THE STATIC', 'RECITE THE SIGIL', 'PICK THE LOCK']);
  let previous, seen = new Set();
  for (let i = 0; i < 100; i++) { const game = h.arena.random(); assert.notEqual(game, previous); seen.add(game.name); previous = game; }
  assert.equal(seen.size, 5);
  assert.equal(h.arena.tier(h.game), 0); h.arena.record(h.game, true); assert.equal(h.arena.tier(h.game), 1);
  assert.equal(h.arena.tier(h.arena.byName('sigil')), 0);
  const reloaded = load(1, h.storage); assert.equal(reloaded.arena.tier(reloaded.game), 1);
  h.arena.record(h.game, false); assert.equal(h.arena.tier(h.game), 1);
  h.arena.record(h.game, false); assert.equal(h.arena.tier(h.game), 0);
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.equal((html.match(/web\/js\/games\/lock\.js/g) || []).length, 1);
  assert.ok(html.indexOf('web/js/arena.js') < html.indexOf('web/js/games/lock.js'));
});

test('lock: all gameplay phases render finite, integer-aligned one-bit pixels', () => {
  const h = load(), s = h.init();
  const phases = new Set(); let result;
  for (let frame = 0; frame < 600 && result === undefined; frame++) {
    if (s.phase === 'sweep' && !s.strikes) h.key(' ');
    else if (s.phase === 'sweep' && inside(s)) h.touch();
    result = h.game.step(s, 1 / 60); phases.add(s.phase); h.game.draw(s);
  }
  assert.equal(result, true);
  for (const phase of ['ready', 'sweep', 'recover', 'caught', 'opening']) assert.ok(phases.has(phase), phase);
  for (const pixel of h.pixels) {
    assert.ok([pixel.x, pixel.y, pixel.w, pixel.h].every(Number.isInteger));
    assert.ok(pixel.w >= 0 && pixel.h >= 0); assert.ok(['#000', '#fff'].includes(pixel.colour));
  }
});

test('lock: terminal results are stable and a fresh trial resets all gameplay state', () => {
  const h = load();
  for (const outcome of ['win', 'jam', 'timeout']) {
    const s = h.init(5); let result;
    for (let frame = 0; frame < 700 && result === undefined; frame++) {
      if (s.phase === 'sweep' && (outcome === 'jam' ? !inside(s) : outcome === 'win' && inside(s))) h.key(' ');
      result = h.game.step(s, 1 / 60);
    }
    assert.equal(result, outcome === 'win');
    const snapshot = JSON.stringify(s), soundCount = h.calls.length;
    for (let frame = 0; frame < 10; frame++) { h.key(' '); h.touch(); assert.equal(h.game.step(s, .05), result); }
    assert.equal(JSON.stringify(s), snapshot, `${outcome}: terminal state must not keep playing`);
    assert.equal(h.calls.length, soundCount, `${outcome}: terminal sounds must not repeat`);
    const fresh = h.init(5);
    assert.equal(fresh.picked, 0); assert.equal(fresh.strikes, 0); assert.equal(fresh.row, 0);
    assert.equal(fresh.phase, 'ready'); assert.equal(fresh.result, undefined);
    assert.equal(fresh.open, 0); assert.equal(fresh.time, fresh.limit); assert.equal(fresh.danger, false);
    assert.ok(fresh.tumblers.every(t => !t.set && t.hit === undefined));
    assert.equal(h.game.step(fresh, .05), undefined); assert.equal(fresh.strikes, 0);
  }
});
