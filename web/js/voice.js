'use strict';
// ------------------------------ VOICE --------------------------------
// speechSynthesis pitched as low as it goes, over a synthesized demon layer:
// detuned sub-bass saws ring-modulated and driven into an asymmetric clipper,
// split into a chest lowpass and a throat bandpass whose formant jumps on every
// word, with a pitch wobble and a tremor, into the reverb. It is pulsed on every
// word boundary with a crackle of static, so the voice reads as something
// inhuman even where the engine ignores pitch (iOS). Subtitles are typed in
// sync with the words. The voice has two tones: 'demon' (the default) and
// 'kind', used while the hidden switch holds: normal pitch, no growl, a soft
// hum underneath, no static in the subtitles.
const Voice = (() => {
  let speaking = false, voices = [], tone = 'demon', ending = null;   // ending: how to end the line being said
  const TONES = { demon: { pitch: 0.15, rate: 0.8 }, kind: { pitch: 1.0, rate: 0.95 } };
  const lineEl = $('line');
  const hasTTS = 'speechSynthesis' in window;
  function loadVoices() { if (hasTTS) voices = speechSynthesis.getVoices(); }
  if (hasTTS) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  function pickVoice() {
    const pref = ['Daniel', 'Microsoft David', 'Microsoft George', 'Microsoft Ryan', 'Microsoft Guy', 'Microsoft Mark', 'Google UK English Male', 'Arthur', 'Oliver', 'Fred', 'Rishi', 'Alex', 'Aaron', 'en-GB', 'en-US', 'en'];
    for (const p of pref) { const v = voices.find(v => (v.name + ' ' + v.lang).includes(p)); if (v) return v; }
    return voices[0] || null;
  }
  const GLYPHS = '▓▒░█▌▐╣║╗╝┤┐└┴┬├─┼╚╔╩╦╠═╬#%&@';
  function renderLine(text, n, final, el = lineEl, plain = false) {
    el.textContent = text.slice(0, n);
    if (!final && !plain && tone === 'demon' && n < text.length && Math.random() < .35) el.textContent += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    if (!final) { const c = document.createElement('span'); c.className = 'cur'; el.appendChild(c); }
  }

  function growl(ms) {
    const AC = Audio_.ctx(); if (!AC) return null;
    const t = AC.currentTime, bus = Audio_.voiceBus(), send = Audio_.send();
    // source: two sub-bass saws a few cents apart and a square an octave up, all wobbling together
    const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 41;
    const o2 = AC.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 41.6;
    const o3 = AC.createOscillator(); o3.type = 'square'; o3.frequency.value = 82.4;
    const wob = AC.createOscillator(); wob.frequency.value = 5.3; const wobG = AC.createGain(); wobG.gain.value = 1.6;
    wob.connect(wobG); [o, o2, o3].forEach(x => wobG.connect(x.frequency));
    const pre = AC.createGain(); pre.gain.value = .5; o.connect(pre); o2.connect(pre); o3.connect(pre);
    // ring modulation against a 38 Hz carrier, mixed with the dry signal, then an asymmetric clipper
    const ring = AC.createGain(); ring.gain.value = 0; const car = AC.createOscillator(); car.frequency.value = 38; car.connect(ring.gain); pre.connect(ring);
    const ws = AC.createWaveShaper(); const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = i / 256 - 1; curve[i] = Math.tanh(x * 9 + x * x * 1.5) * .9; } ws.curve = curve; ws.oversample = '2x';
    pre.connect(ws); ring.connect(ws);
    // chest and throat
    const chest = AC.createBiquadFilter(); chest.type = 'lowpass'; chest.frequency.value = 360; chest.Q.value = 3;
    const throat = AC.createBiquadFilter(); throat.type = 'bandpass'; throat.frequency.value = 480; throat.Q.value = 5;
    const throatG = AC.createGain(); throatG.gain.value = .9;
    ws.connect(chest); ws.connect(throat); throat.connect(throatG);
    const trem = AC.createOscillator(); trem.frequency.value = 27; const tg = AC.createGain(); tg.gain.value = .35;
    const mod = AC.createGain(); mod.gain.value = 1; trem.connect(tg); tg.connect(mod.gain);
    chest.connect(mod); throatG.connect(mod);
    const amp = AC.createGain(); amp.gain.value = 0; mod.connect(amp); amp.connect(bus); amp.connect(send);
    const nodes = [o, o2, o3, wob, car, trem]; nodes.forEach(n => n.start());
    amp.gain.linearRampToValueAtTime(.09, t + .12);
    let ended = false;
    const end = () => {
      if (ended) return; ended = true; clearTimeout(cap);
      const t2 = AC.currentTime; amp.gain.cancelScheduledValues(t2); amp.gain.setValueAtTime(amp.gain.value, t2); amp.gain.linearRampToValueAtTime(0, t2 + .3);
      setTimeout(() => nodes.forEach(n => { try { n.stop(); } catch (e) {} }), 450);
    };
    const FORMANTS = [320, 470, 640, 860, 1100];
    const pulse = () => {
      if (ended) return;
      const t2 = AC.currentTime; amp.gain.cancelScheduledValues(t2); amp.gain.setValueAtTime(amp.gain.value, t2);
      amp.gain.linearRampToValueAtTime(.22, t2 + .035); amp.gain.linearRampToValueAtTime(.09, t2 + .24);
      const f0 = 36 + Math.random() * 12; o.frequency.setValueAtTime(f0, t2); o2.frequency.setValueAtTime(f0 * 1.014, t2); o3.frequency.setValueAtTime(f0 * 2.01, t2);
      throat.frequency.cancelScheduledValues(t2); throat.frequency.setValueAtTime(pick(FORMANTS), t2); throat.frequency.exponentialRampToValueAtTime(380, t2 + .3);
      // a crackle of static under each word
      const n = AC.createBufferSource(); n.buffer = Audio_.noise(); n.playbackRate.value = rnd(.6, 1.4);
      const nf = AC.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = rnd(1400, 3200); nf.Q.value = 1.2;
      const ng = AC.createGain(); ng.gain.setValueAtTime(.05, t2); ng.gain.exponentialRampToValueAtTime(.0005, t2 + .09);
      n.connect(nf); nf.connect(ng); ng.connect(bus); n.start(t2, Math.random() * 1.5); n.stop(t2 + .1);
    };
    const cap = setTimeout(end, ms + 2500);
    return { end, pulse };
  }

  // the kind tone's layer: a soft hum with a slow vibrato and a breath of filtered noise,
  // swelling a little on every word. Same interface as growl().
  function hum(ms) {
    const AC = Audio_.ctx(); if (!AC) return null;
    const t = AC.currentTime, bus = Audio_.voiceBus(), send = Audio_.send();
    const o = AC.createOscillator(); o.type = 'sine'; o.frequency.value = 164.8;
    const o2 = AC.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 247; 
    const vib = AC.createOscillator(); vib.frequency.value = 4.5; const vg = AC.createGain(); vg.gain.value = 2.5; vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = .7;
    const g2 = AC.createGain(); g2.gain.value = .35; o2.connect(g2); g2.connect(lp); o.connect(lp);
    const amp = AC.createGain(); amp.gain.value = 0; lp.connect(amp); amp.connect(bus); amp.connect(send);
    const nodes = [o, o2, vib]; nodes.forEach(n => n.start());
    amp.gain.linearRampToValueAtTime(.05, t + .2);
    let ended = false;
    const end = () => {
      if (ended) return; ended = true; clearTimeout(cap);
      const t2 = AC.currentTime; amp.gain.cancelScheduledValues(t2); amp.gain.setValueAtTime(amp.gain.value, t2); amp.gain.linearRampToValueAtTime(0, t2 + .4);
      setTimeout(() => nodes.forEach(n => { try { n.stop(); } catch (e) {} }), 550);
    };
    const pulse = () => {
      if (ended) return;
      const t2 = AC.currentTime; amp.gain.cancelScheduledValues(t2); amp.gain.setValueAtTime(amp.gain.value, t2);
      amp.gain.linearRampToValueAtTime(.1, t2 + .05); amp.gain.linearRampToValueAtTime(.05, t2 + .3);
      const f0 = 150 + Math.random() * 30; o.frequency.setTargetAtTime(f0, t2, .08); o2.frequency.setTargetAtTime(f0 * 1.5, t2, .08);
      const n = AC.createBufferSource(); n.buffer = Audio_.noise(); n.playbackRate.value = rnd(.8, 1.2);
      const nf = AC.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = rnd(900, 1600); nf.Q.value = .8;
      const ng = AC.createGain(); ng.gain.setValueAtTime(.012, t2); ng.gain.exponentialRampToValueAtTime(.0005, t2 + .12);
      n.connect(nf); nf.connect(ng); ng.connect(bus); n.start(t2, Math.random() * 1.5); n.stop(t2 + .13);
    };
    const cap = setTimeout(end, ms + 2500);
    return { end, pulse };
  }

  function say(text, opts = {}) {
    return new Promise(res => {
      speaking = true;
      const total = text.length, ms = Math.max(1200, total * 68 / CONFIG.voice.rate);
      const el = opts.el || lineEl, plain = !!opts.plain, silent = !!opts.silent;
      const render = (n, final) => { if (!silent) renderLine(text, n, final, el, plain); };
      let shown = 0, done = false, began = false, timer = 0, keep = 0, g = null;
      const finish = () => {
        if (done) return; done = true; speaking = false; if (ending === finish) ending = null;
        clearInterval(timer); clearInterval(keep); g && g.end(); render(total, true);
        setTimeout(res, opts.hold ?? 300);
      };
      ending = finish;
      const start = () => {
        if (began) return; began = true;
        g = tone === 'kind' ? hum(ms) : growl(ms);
        timer = setInterval(() => { if (shown < total) { shown++; render(shown, false); } }, 58 / CONFIG.voice.rate);
      };
      if (!hasTTS || !(voices.length || (loadVoices(), voices.length))) { start(); setTimeout(finish, ms); return; }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(); if (v) u.voice = v;
      u.pitch = CONFIG.voice.pitch; u.rate = CONFIG.voice.rate; u.volume = 1;
      u.onstart = start;
      u.onboundary = e => { if (e.name === 'word') { shown = Math.max(shown, e.charIndex); g && g.pulse(); } };
      u.onend = finish; u.onerror = finish;
      speechSynthesis.speak(u);
      // Chrome desktop cuts long utterances after ~15s unless nudged.
      if (total > 150 && /Chrome/.test(navigator.userAgent) && !/Mobile|Android/.test(navigator.userAgent))
        keep = setInterval(() => { if (speechSynthesis.speaking) { speechSynthesis.pause(); speechSynthesis.resume(); } }, 9000);
      setTimeout(() => { if (!began && !done) { start(); setTimeout(finish, ms); } }, 1500); // TTS never started: timed fallback
      setTimeout(() => !done && finish(), ms * 2.5 + 5000);                                 // hard cap
    });
  }
  // stop() ends the line being said, spoken or (with no system voice) only timed
  function stop() { if (hasTTS) speechSynthesis.cancel(); if (ending) ending(); }
  function setTone(name) { tone = TONES[name] ? name : 'demon'; Object.assign(CONFIG.voice, TONES[tone]); }

  // Electron has no speech-recognition service behind this API (Chrome's is Google's,
  // keyed to Chrome), so the desktop app hides MIC and the question is typed.
  const SR = CONFIG.desktop ? null : window.SpeechRecognition || window.webkitSpeechRecognition;
  function listen(onInterim) {
    return new Promise(res => {
      if (!SR) return res(null);
      const r = new SR(); r.lang = navigator.language || 'en-US'; r.interimResults = true; r.maxAlternatives = 1;
      let text = '', settled = false;
      const done = v => { if (!settled) { settled = true; clearTimeout(cap); res(v || null); } };
      r.onresult = e => { text = Array.from(e.results, rs => rs[0].transcript).join(''); onInterim && onInterim(text); };
      r.onerror = () => done(text); r.onend = () => done(text);
      try { r.start(); } catch (e) { done(null); }
      const cap = setTimeout(() => { try { r.stop(); } catch (e) {} }, 9000);
    });
  }
  return { say, stop, listen, setTone, tone: () => tone, canListen: !!SR, speaking: () => speaking };
})();
