'use strict';
// -------------------------------- WAKE -------------------------------
// The first tap: audio may start, the eye opens, the bridge is probed.
$('wake').addEventListener('click', async function () {
  if (this.classList.contains('off')) return;
  this.classList.add('off');
  Bridge.detect();
  Audio_.init(); await Audio_.resume();
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
  Eye.start(); Eye.setMood('waking');
  Audio_.sfx.ignite(); Audio_.startDrone(); Audio_.setIntensity(.3); buzz([20, 80, 60]);
  setTimeout(() => this.remove(), 1400);
  await wait(2300);
  Eye.setMood('idle'); Audio_.setIntensity(.1);
  await Voice.say(pick(['I am awake. Ask, if you dare.', 'You woke me. Make it worth it.', 'The session is sealed. Ask anyway.']));
}, { once: false });
document.addEventListener('visibilitychange', () => { if (!document.hidden) Audio_.resume(); });

// Console / test handle: GK.gate('question'), GK.arena.end(true) to force a win, GK.arena.run(GK.arena.byName('sigil'), 2),
// GK.arena.current() for the running game's state, GK.arena.skill() for each game's tier, GK.arena.forget(), GK.eye.setMood('angry'),
// GK.bridge.auto() to look for Claude Code again, GK.bridge.chooseRepo(), GK.setup.show(true), GK.switch.state() / loosen() / throw() / corrupt() for the hidden panel.
window.GK = { gate: Gate.gate, say: Voice.say, eye: Eye, arena: Arena, audio: Audio_, voice: Voice, stats: Gate.stats, askClaude, bridge: Bridge, setup: Setup, switch: Switch, bus: Bus, config: CONFIG };
