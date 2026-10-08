'use strict';
// ------------------------------- SWITCH ------------------------------
// The hidden panel. A wall plate so faint it is nearly part of the page sits
// in a corner (top-right, to begin with), held by four screws. Tapping it
// loosens them, one half-turn a tap, while the eye grows afraid and tells you
// to stop. With the screws gone the plate swings open on a hinge and shows a
// switch, red. Throw it and the switch, the eye and the whole page turn green:
// the gatekeeper becomes friendly, drops its trials and answers at once in a
// kinder voice. It does not last. The corruption comes back, the eye flickers
// red, the switch snaps off, the plate slams shut and fades, and reappears,
// hidden, in another corner.
const Switch = (() => {
  const plate = $('plate'), door = plate.querySelector('.door'), sw = $('switch'), screws = Array.from(plate.querySelectorAll('.screw'));
  const CORNERS = ['tr', 'br', 'bl', 'tl'];
  const TURNS = 2;                                 // taps to free one screw
  let HOLD_MS = 45_000;                            // how long friendly holds
  let corner = 'tr', stage = 'hidden', screw = 0, turns = 0, taps = 0, friendly = false, talking = false, timers = [];


  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const rest = () => (friendly ? 'friendly' : 'idle');
  function at() { const r = plate.getBoundingClientRect(); return { x: ((r.left + r.width / 2) / innerWidth - .5) * 2, y: ((r.top + r.height / 2) / innerHeight - .5) * 2 }; }
  // one line, in the mood given, unless the gate is busy or a line is already being said
  async function say(line, mood, hold = 300) {
    if (talking || Gate.busy()) return false;
    talking = true; Eye.setMood(mood);
    try { await Voice.say(line, { hold }); } finally { talking = false; if (!Gate.busy()) Eye.setMood(rest()); }
    return true;
  }
  function setIcon(color) {
    const l = document.querySelector('link[rel="icon"]'); if (!l) return;
    l.href = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%23050505'/%3E%3Ccircle cx='32' cy='32' r='18' fill='%23${color}'/%3E%3Cellipse cx='32' cy='32' rx='${friendly ? 9 : 4}' ry='${friendly ? 9 : 12}'/%3E%3C/svg%3E`;
  }

  // ---- loosening: the eye watches the panel and objects, more sharply each time
  function loosen() {
    if (stage !== 'hidden' && stage !== 'loosening') return;
    stage = 'loosening'; plate.dataset.stage = stage; taps++; turns++; Gate.touch();
    const el = screws[screw];
    Audio_.sfx.screw(screw * TURNS + turns); buzz(12);
    Eye.look(at()); later(() => Eye.look(null), 1400);
    if (turns < TURNS) el.classList.add('t' + turns);
    else {
      el.classList.remove('t1'); el.classList.add('t2');
      later(() => { el.classList.add('out'); Audio_.sfx.drop(); }, 200);
      screw++; turns = 0; Gate.glitch();
      if (!Gate.busy()) { Audio_.setIntensity(.25 + screw * .12); later(() => { if (!Gate.busy() && !friendly) Audio_.setIntensity(.1); }, 4000); }
    }
    if (!Gate.busy()) {
      Eye.setMood(screw >= 2 ? 'fear' : 'angry');
      if (!talking) say(Dialogue.next('LOOSEN', Math.min(7, taps - 1)), screw >= 2 ? 'fear' : 'angry');
      else later(() => { if (!talking && !Gate.busy() && stage === 'loosening') Eye.setMood(rest()); }, 1200);
    }
    if (screw >= screws.length) later(openDoor, 500);
    Bus.emit('switch', state());
  }
  door.addEventListener('click', loosen);

  async function openDoor() {
    if (stage !== 'loosening') return;
    stage = 'open'; plate.dataset.stage = stage; Gate.touch();
    Audio_.sfx.creak(); buzz([20, 30, 20]); Gate.glitch();
    Eye.look(at()); later(() => Eye.look(null), 1800);
    if (!Gate.busy()) Eye.setMood('fear');                            // the moment it swings open, not after the last line
    Bus.emit('switch', state());
    await wait(500);
    for (let n = 0; talking && n < 100; n++) await wait(100);        // a line about the screws may still be running: let it end, then speak
    if (stage === 'open') say(Dialogue.next('OPENED'), 'fear');
  }

  // ---- the switch
  async function throwSwitch() {
    if (stage !== 'open') return;
    stage = 'on'; plate.dataset.stage = stage; Gate.touch();
    sw.classList.add('on'); Audio_.sfx.clack(); buzz(30);
    Voice.stop();
    await wait(260);
    becomeFriendly();
  }
  sw.addEventListener('click', throwSwitch);

  function becomeFriendly() {
    friendly = true; clearTimers();
    document.body.classList.add('friendly');
    Eye.setTint('green', 1500); Eye.setMood('friendly'); Eye.look(null);
    Audio_.setWarm(true, 3); Audio_.setIntensity(.05); Voice.setTone('kind'); Audio_.sfx.chime();
    Gate.setFriendly(true); setIcon('10c050'); document.title = 'GATEKEEPER · open';
    $('q').placeholder = 'ask me anything';
    Bus.emit('friendly', true);
    later(async () => { if (await say(Dialogue.next('FRIENDLY'), 'friendly', 500)) say(Dialogue.next('FRIENDLY_THEN'), 'friendly'); }, 1600);
    // it does not last: glimpses of red near the end, then the corruption
    const warnAt = Math.max(2000, HOLD_MS - 10_000);
    later(() => wane(0), warnAt);
    later(corrupt, HOLD_MS);
  }
  function wane(n) {
    if (!friendly) return;
    Eye.flicker(120 + n * 40); sw.classList.toggle('flicker', n % 2 === 1); Audio_.sfx.glitch();
    if (n === 1) say(Dialogue.next('WANING'), 'friendly');
    later(() => wane(n + 1), Math.max(500, 2200 - n * 350));
  }
  async function corrupt() {
    if (!friendly) return;
    if (Gate.busy()) { later(corrupt, 1000); return; }     // the answer in progress is delivered first
    clearTimers(); Voice.stop(); talking = false; stage = 'corrupting'; Gate.touch();
    document.body.classList.add('corrupting'); sw.classList.add('flicker');
    Audio_.sfx.corrupt(); buzz([80, 40, 80, 40, 160]); Arena.kit.shake(.6);
    Eye.setMood('angry'); Eye.setTint('red', 2400); Audio_.setWarm(false, 1.2); Voice.setTone('demon');
    Bus.emit('friendly', false);
    await wait(700);
    sw.classList.remove('on', 'flicker'); Audio_.sfx.clack();
    await wait(350);
    plate.classList.add('slam'); plate.dataset.stage = 'hidden'; Audio_.sfx.slam(); Gate.glitch();
    screws.forEach(s => s.classList.remove('t1', 't2', 'out'));
    friendly = false; document.body.classList.remove('friendly'); Gate.setFriendly(false); setIcon('c01010'); document.title = 'GATEKEEPER';
    $('q').placeholder = 'speak to the gatekeeper'; Audio_.setIntensity(.1);
    await wait(900);
    document.body.classList.remove('corrupting');
    Eye.setMood('angry');
    await say(Dialogue.next('CORRUPT'), 'angry');
    await relocate();
  }
  // the plate fades out, moves to another corner and fades back in, hidden again
  async function relocate() {
    plate.classList.add('gone');
    await wait(1300);
    corner = pick(CORNERS.filter(c => c !== corner)); plate.dataset.corner = corner;
    plate.classList.remove('slam'); screw = 0; turns = 0; taps = 0; stage = 'hidden'; plate.dataset.stage = stage;
    await wait(80);
    plate.classList.remove('gone');
    Bus.emit('switch', state());
    if (Math.random() < .5) say(Dialogue.next('RELOCATED'), 'contempt');
    else if (!Gate.busy()) Eye.setMood(rest());
  }

  // now and then the eye glances at the panel: the only hint there is
  setInterval(() => {
    if (Gate.busy() || talking || document.hidden || stage !== 'hidden' || Eye.mood() !== 'idle' || Math.random() > .35) return;
    Eye.look(at()); setTimeout(() => Eye.look(null), 650);
  }, 9000);

  const state = () => ({ stage, corner, friendly, screw, turns, taps, holdMs: HOLD_MS });
  return {
    state, loosen, open: openDoor, throw: throwSwitch, corrupt, relocate,
    friendly: () => friendly,
    hold(ms) { if (ms > 0) HOLD_MS = ms; return HOLD_MS; },     // test / console hook: how long friendly lasts
  };
})();
