'use strict';
// ------------------------------ AUDIO --------------------------------
// Everything is synthesized: no audio files. Buses: music (drone, beat),
// sfx (one-bit blips), voice (the mechanical layer under the TTS, which
// also feeds the analyser that drives the waveform bar).
const Audio_ = (() => {
  let AC, master, analyser, music, sfxBus, voiceBus, verbSend, noiseBuf;
  let drone = null, beat = null, intensity = 0, danger = false, warm = false, pad = null;
  // the drone's two chords: the gatekeeper's bare fifths, and the warm major it drifts to when switched friendly
  const COLD = [36.7, 36.95, 55, 73.4, 110.3, 146.8], WARM = [43.65, 43.9, 65.4, 87.3, 110, 130.8];
  const heart = { at: 0, per: 1400 };            // when the last thump landed (perf.now ms) and the period

  function init() {
    if (AC) return AC;
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const comp = AC.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.connect(AC.destination);
    master = AC.createGain(); master.gain.value = .9; master.connect(comp);
    analyser = AC.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = .4;
    music = AC.createGain(); music.gain.value = .85; music.connect(master);
    sfxBus = AC.createGain(); sfxBus.gain.value = .7; sfxBus.connect(master);
    voiceBus = AC.createGain(); voiceBus.gain.value = 1; voiceBus.connect(master); voiceBus.connect(analyser);
    const reverb = AC.createConvolver(); reverb.buffer = impulse(3.4, 2.4);
    verbSend = AC.createGain(); verbSend.gain.value = .45; verbSend.connect(reverb); reverb.connect(master);
    noiseBuf = brown(2);
    return AC;
  }
  function impulse(sec, decay) {
    const len = AC.sampleRate * sec, b = AC.createBuffer(2, len, AC.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  function brown(sec) {
    const len = AC.sampleRate * sec, b = AC.createBuffer(1, len, AC.sampleRate), d = b.getChannelData(0);
    for (let i = 0, l = 0; i < len; i++) { l = (l + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; }
    return b;
  }

  // ---- drone: detuned saws/squares -> resonant lowpass swept by a slow LFO, a breathing noise bed,
  //      a heartbeat whose tempo follows `intensity`, and distant metallic hits in the reverb.
  function startDrone() {
    if (!AC || drone) return;
    const t = AC.currentTime;
    const g = AC.createGain(); g.gain.value = 0;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 5;
    const lfo = AC.createOscillator(); lfo.frequency.value = .06;
    const lfoG = AC.createGain(); lfoG.gain.value = 120; lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
    const oscs = (warm ? WARM : COLD).map((f, i) => {
      const o = AC.createOscillator(); o.type = i % 2 ? 'sawtooth' : 'square'; o.frequency.value = f; o.detune.value = (i - 2.5) * 6;
      const og = AC.createGain(); og.gain.value = .14 / (i + 1); o.connect(og); og.connect(lp); o.start(); return o;
    });
    const br = AC.createBufferSource(); br.buffer = noiseBuf; br.loop = true;
    const bf = AC.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 320; bf.Q.value = .7;
    const bg = AC.createGain(); bg.gain.value = .06;
    const blfo = AC.createOscillator(); blfo.frequency.value = .11;
    const blg = AC.createGain(); blg.gain.value = .05; blfo.connect(blg); blg.connect(bg.gain); blfo.start();
    br.connect(bf); bf.connect(bg); bg.connect(g); bg.connect(verbSend); br.start();
    lp.connect(g); g.connect(music); g.connect(verbSend);
    g.gain.linearRampToValueAtTime(.42, t + 3);
    drone = { g, lp, oscs, nodes: [lfo, blfo, br, ...oscs], hb: 0, hit: 0 };
    heartbeat(); hits();
  }
  function thump(t, vol) {
    const o = AC.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(34, t + .25);
    const g = AC.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .02); g.gain.exponentialRampToValueAtTime(.001, t + .38);
    o.connect(g); g.connect(music); o.start(t); o.stop(t + .4);
  }
  function heartbeat() {
    if (!drone) return;
    const t = AC.currentTime + .05, per = 60 / (warm ? 38 + intensity * 40 : 44 + intensity * 86);
    thump(t, .5 + intensity * .3); thump(t + per * .28, .28 + intensity * .2);
    heart.at = performance.now() + 50; heart.per = per * 1000;
    drone.hb = setTimeout(heartbeat, per * 1000);
  }
  function hits() {
    if (!drone) return;
    const t = AC.currentTime, n = AC.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = rnd(600, 2400); f.Q.value = 18;
    const g = AC.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rnd(.08, .2), t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + rnd(.6, 1.8));
    n.connect(f); f.connect(g); g.connect(verbSend); g.connect(music); n.start(t); n.stop(t + 2);
    drone.hit = setTimeout(hits, rnd(5000, 14000) * (1.2 - intensity * .8));
  }
  function setIntensity(v) {
    intensity = clamp(v, 0, 1);
    if (!drone) return;
    const t = AC.currentTime;
    const ramp = (p, to) => { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(to, t + 1.5); };
    ramp(drone.lp.frequency, (warm ? 320 : 180) + intensity * 900); ramp(drone.g.gain, .42 + intensity * .26);
  }
  function setDanger(v) { danger = !!v; }      // the beat grows an alarm while a game is on its last life
  // ---- warmth: when the hidden switch is thrown the drone glides from its bare fifths to a
  //      major chord, the filter opens, the heartbeat slows and a soft pad joins; all of it
  //      is taken back when the eye corrupts.
  function setWarm(v, sec = 2.5) {
    warm = !!v;
    if (!AC) return;
    const t = AC.currentTime;
    if (drone) {
      drone.oscs.forEach((o, i) => { o.frequency.cancelScheduledValues(t); o.frequency.setValueAtTime(o.frequency.value, t); o.frequency.exponentialRampToValueAtTime((warm ? WARM : COLD)[i], t + sec); });
      drone.lp.Q.cancelScheduledValues(t); drone.lp.Q.setValueAtTime(drone.lp.Q.value, t); drone.lp.Q.linearRampToValueAtTime(warm ? 1.5 : 5, t + sec);
      setIntensity(intensity);
    }
    if (warm && !pad) {
      const g = AC.createGain(); g.gain.value = 0; g.connect(music); g.connect(verbSend);
      const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(g);
      const trem = AC.createOscillator(); trem.frequency.value = .35; const tg = AC.createGain(); tg.gain.value = .35; trem.connect(tg); tg.connect(g.gain); trem.start();
      const oscs = [174.6, 220, 261.6, 349.2].map((f, i) => { const o = AC.createOscillator(); o.type = i === 3 ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = (i - 1.5) * 4; const og = AC.createGain(); og.gain.value = .22 / (i + 1); o.connect(og); og.connect(lp); o.start(); return o; });
      g.gain.linearRampToValueAtTime(.16, t + sec);
      pad = { g, nodes: [trem, ...oscs] };
    } else if (!warm && pad) {
      const p = pad; pad = null;
      p.g.gain.cancelScheduledValues(t); p.g.gain.setValueAtTime(p.g.gain.value, t); p.g.gain.linearRampToValueAtTime(0, t + Math.min(sec, 1));
      setTimeout(() => p.nodes.forEach(n => { try { n.stop(); } catch (e) {} }), Math.min(sec, 1) * 1000 + 200);
    }
  }
  function stopDrone() {
    if (!drone) return;
    const d = drone; drone = null; clearTimeout(d.hb); clearTimeout(d.hit);
    d.g.gain.cancelScheduledValues(AC.currentTime); d.g.gain.linearRampToValueAtTime(0, AC.currentTime + 2);
    setTimeout(() => d.nodes.forEach(n => { try { n.stop(); } catch (e) {} }), 2200);
  }

  // ---- combat pulse: an 8th-note bass sequence under a kick, whose tempo follows `intensity`;
  //      hats double at high intensity and a two-tone alarm joins while `danger` is set.
  const SEQ = [0, 0, 3, 0, 5, 0, 3, 2, 0, 0, 3, 0, 7, 6, 3, 2];
  function startBeat() {
    if (!AC || beat) return;
    let i = 0, next = AC.currentTime + .1;
    beat = { timer: 0 };
    const tick = () => {
      if (!beat) return;
      const step = 60 / (116 + intensity * 64) / 2;
      while (next < AC.currentTime + .25) {
        const f = 55 * Math.pow(2, SEQ[i % SEQ.length] / 12);
        const o = AC.createOscillator(); o.type = 'square'; o.frequency.value = f;
        const o2 = AC.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 2.003;
        const fl = AC.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(900, next); fl.frequency.exponentialRampToValueAtTime(140, next + step * .9);
        const g = AC.createGain(); g.gain.setValueAtTime(0, next); g.gain.linearRampToValueAtTime(i % 4 === 0 ? .2 : .12, next + .01); g.gain.exponentialRampToValueAtTime(.001, next + step * .95);
        o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(music); o.start(next); o2.start(next); o.stop(next + step); o2.stop(next + step);
        if (i % 8 === 0) {   // kick
          const ko = AC.createOscillator(); ko.type = 'sine'; ko.frequency.setValueAtTime(130, next); ko.frequency.exponentialRampToValueAtTime(38, next + .12);
          const kg = AC.createGain(); kg.gain.setValueAtTime(.5, next); kg.gain.exponentialRampToValueAtTime(.001, next + .22);
          ko.connect(kg); kg.connect(music); ko.start(next); ko.stop(next + .25);
        }
        if (i % 8 === 4 || (intensity > .8 && i % 2 === 1)) {   // hats
          const n = AC.createBufferSource(); n.buffer = noiseBuf; const hf = AC.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 5000;
          const hg = AC.createGain(); hg.gain.setValueAtTime(i % 8 === 4 ? .07 : .03, next); hg.gain.exponentialRampToValueAtTime(.001, next + .05);
          n.connect(hf); hf.connect(hg); hg.connect(music); n.start(next); n.stop(next + .06);
        }
        if (danger && i % 8 === 6) {   // alarm
          const a = AC.createOscillator(); a.type = 'sawtooth'; a.frequency.setValueAtTime(1180, next); a.frequency.exponentialRampToValueAtTime(880, next + step * 1.6);
          const af = AC.createBiquadFilter(); af.type = 'bandpass'; af.frequency.value = 1000; af.Q.value = 3;
          const ag = AC.createGain(); ag.gain.setValueAtTime(.06, next); ag.gain.exponentialRampToValueAtTime(.001, next + step * 1.8);
          a.connect(af); af.connect(ag); ag.connect(music); ag.connect(verbSend); a.start(next); a.stop(next + step * 2);
        }
        next += step; i++;
      }
      beat.timer = setTimeout(tick, 80);
    };
    tick();
  }
  function stopBeat() { if (beat) { clearTimeout(beat.timer); beat = null; } }

  // ---- one-bit sfx
  function tone(type, f0, f1, dur, vol, bus, at) {
    const t = at ?? AC.currentTime, o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    o.connect(g); g.connect(bus || sfxBus); o.start(t); o.stop(t + dur + .02);
  }
  function rumble(dur, vol, hz) {
    const t = AC.currentTime, n = AC.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const f = AC.createBiquadFilter(); f.type = hz ? 'bandpass' : 'lowpass'; f.frequency.value = hz || 400; f.Q.value = hz ? 1.5 : 1;
    const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    n.connect(f); f.connect(g); g.connect(sfxBus); g.connect(verbSend); n.start(t); n.stop(t + dur + .05);
  }
  const guard = fn => (...a) => { if (AC) try { fn(...a); } catch (e) {} };
  const sfx = {
    blip:   guard(() => tone('square', 880, 880, .06, .12)),
    bounce: guard(() => tone('square', 440, 440, .05, .1)),
    hit:    guard(() => tone('square', 220, 90, .12, .18)),
    smash:  guard(() => { tone('square', 1200, 300, .09, .14); tone('triangle', 600, 2400, .06, .08); }),
    shoot:  guard(() => tone('square', 1400, 500, .07, .06)),
    kill:   guard(() => { tone('square', 300, 60, .18, .16); rumble(.2, .18, 900); }),
    hurt:   guard(() => { tone('sawtooth', 160, 40, .35, .25); rumble(.3, .3); }),
    count:  guard(go => tone('square', go ? 880 : 440, go ? 880 : 440, go ? .3 : .08, .14)),
    win:    guard(() => [330, 440, 554, 880].forEach((f, i) => tone('square', f, f, .25, .13, sfxBus, AC.currentTime + i * .12))),
    lose:   guard(() => { tone('sawtooth', 220, 28, 1.2, .3); tone('square', 233, 30, 1.2, .18); }),
    thud:   guard(() => { tone('sine', 70, 28, .6, .9, music); rumble(.6, .25); }),
    glitch: guard(() => rumble(.45, .35, 1800)),
    ignite: guard(() => { tone('sawtooth', 30, 110, 2.5, .25, music); rumble(2.5, .2, 220); }),
    rune:   guard(i => { const f = [196, 247, 294, 392][i] || 196; tone('square', f, f, .18, .14); tone('square', f * 2.01, f * 2.01, .12, .04); }),
    // the hidden panel
    screw:  guard(n => { const f = 2400 - n * 300; tone('sawtooth', f, f * .55, .14, .05); rumble(.12, .14, f * .8); tone('square', 110, 60, .05, .08); }),
    drop:   guard(() => { tone('triangle', 3200, 2400, .05, .06); setTimeout(() => { tone('triangle', 2600, 1800, .04, .04); rumble(.08, .08, 3000); }, 90); }),
    creak:  guard(() => { tone('sawtooth', 420, 180, .9, .05); rumble(.9, .12, 700); tone('sine', 55, 40, .9, .2, music); }),
    clack:  guard(() => { tone('square', 1800, 900, .03, .14); tone('sine', 140, 70, .09, .3); rumble(.06, .2, 2400); }),
    chime:  guard(() => [349.2, 440, 523.3, 698.5, 880].forEach((f, i) => { tone('sine', f, f, 1.4 - i * .15, .09, music, AC.currentTime + i * .09); tone('triangle', f * 2, f * 2, .5, .02, music, AC.currentTime + i * .09); })),
    slam:   guard(() => { tone('sine', 90, 30, .35, .9, music); rumble(.4, .5); rumble(.12, .3, 2000); }),
    corrupt: guard(() => { for (let i = 0; i < 6; i++) { tone('sawtooth', rnd(80, 900), rnd(30, 1800), .22, .1, sfxBus, AC.currentTime + i * .07); rumble(.18, .2, rnd(300, 4000)); } tone('square', 55, 27, 1.2, .25, music); }),
  };

  async function resume() { if (AC && AC.state === 'suspended') await AC.resume(); }
  return { init, resume, ctx: () => AC, analyser: () => analyser, voiceBus: () => voiceBus, send: () => verbSend, noise: () => noiseBuf,
           startDrone, stopDrone, setIntensity, setDanger, setWarm, warm: () => warm, startBeat, stopBeat, sfx, heart };
})();
