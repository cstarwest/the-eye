'use strict';
// ------------------------------- GATE --------------------------------
// The flow: a question makes the eye angry, it taunts, a trial runs, and only
// a win reaches the oracle. While the hidden switch holds (friendly), there is
// no trial: the eye answers at once, in a kinder voice.
const Gate = (() => {
  const ui = $('ui'), q = $('q'), askBtn = $('ask'), mic = $('mic'), answer = $('answer'), abody = $('abody'), line = $('line');
  let busy = false, friendly = false, fails = 0, wins = 0, lastActivity = performance.now(), attendTimer = 0, currentAsk = null;
  addEventListener('pagehide', () => currentAsk && currentAsk.abort());

  function glitch() { const el = $('glitch'); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); Audio_.sfx.glitch(); buzz(40); }
  function setBusy(v) { busy = v; askBtn.disabled = v; mic.disabled = v; q.disabled = v; }
  function hideAnswer() { answer.classList.remove('on'); }
  function showAnswer() {
    renderReadout('', false);
    $('astamp').textContent = `${CONFIG.oracle || 'NO ORACLE'} · SESSION ${CONFIG.session.toUpperCase()}${friendly ? ' · UNGATED' : ''}`;
    answer.classList.add('on');
  }
  function renderReadout(text, final) {
    abody.textContent = text;
    if (!final) { const c = document.createElement('span'); c.className = 'cur'; abody.appendChild(c); }
    answer.scrollTop = answer.scrollHeight;
  }
  // Speaks the readout sentence by sentence as the text streams in, so the
  // voice starts before the oracle has finished.
  function makeSpeaker() {
    let upTo = 0, queue = [], running = null, started = false;
    const re = /[.!?…]["')\]]*(?:\s+)|\n\s*\n/g;
    const drain = async () => { while (queue.length) await Voice.say(queue.shift(), { silent: true, hold: 80 }); running = null; };
    const kick = () => { if (started && !running && queue.length) running = drain(); };
    return {
      start() { started = true; kick(); },
      push(text) { re.lastIndex = upTo; let m; while ((m = re.exec(text))) { const s = text.slice(upTo, m.index + m[0].length).trim(); upTo = m.index + m[0].length; if (s) queue.push(s); } kick(); },
      async finish(text) { const rest = text.slice(upTo).trim(); upTo = text.length; if (rest) queue.push(rest); started = true; kick(); while (running) await running; },
    };
  }
  function pulseLine(text) { let n = 0; line.textContent = text; const id = setInterval(() => { line.textContent = text + '.'.repeat(n = (n + 1) % 4); }, 400); return () => clearInterval(id); }

  async function gate(question) {
    question = (question || '').trim();
    if (busy || !question) return;
    setBusy(true); hideAnswer(); q.value = ''; q.blur(); lastActivity = performance.now();
    Eye.setMood('attend'); Eye.look({ x: 0, y: .8 });
    await wait(450);
    if (friendly) {                      // the switch holds: no trial, no taunt, straight to the session
      Eye.look(null); Eye.setMood('friendly'); Audio_.sfx.blip(); buzz(10);
      await Voice.say(Dialogue.next('KIND_YES'));
      await consult(question);
      Eye.setMood(friendly ? 'friendly' : 'idle'); setBusy(false); return;
    }
    Eye.look(null); Eye.setMood('angry'); Audio_.setIntensity(.55); Audio_.sfx.thud(); buzz(30);
    await Voice.say(Dialogue.next('TAUNTS'));
    glitch(); Audio_.setIntensity(.7);
    await wait(350);
    Eye.setMood('judge'); ui.classList.add('hidden'); Audio_.startBeat();
    const won = await Arena.trial();      // a game it has not just played, at the tier your record on that game has earned
    Audio_.stopBeat(); ui.classList.remove('hidden'); lastActivity = performance.now();
    if (!won) {
      fails++; Eye.setMood('contempt'); Audio_.setIntensity(.4); Audio_.sfx.lose(); glitch();
      await Voice.say(fails > 1 ? Dialogue.next('LOSE_AGAIN') : Dialogue.next('LOSE'));
      Eye.setMood('idle'); Audio_.setIntensity(.1); setBusy(false); return;
    }
    wins++; fails = 0; Eye.setMood('pleased'); Audio_.setIntensity(.25);
    await Voice.say(wins > 1 ? Dialogue.next('WIN_STREAK') : Dialogue.next('WIN'));
    await consult(question);
    Eye.setMood(friendly ? 'friendly' : 'idle'); setBusy(false);
  }
  // Asks the oracle and plays the answer: the eye rolls up, the readout opens, tool
  // activity shows under the eye, the text types and is spoken as it streams.
  async function consult(question) {
    const kind = friendly;
    Eye.setMood('consult'); kind ? Audio_.sfx.blip() : glitch();
    const ac = new AbortController(); currentAsk = ac;
    const speaker = makeSpeaker();
    let text = '', answer, consulting = true, stopPulse = () => {};
    const openLine = Dialogue.next(kind ? 'KIND_OPEN' : 'OPEN');
    const opened = () => { stopPulse(); stopPulse = () => {}; line.textContent = openLine; Eye.setMood(kind ? 'friendly' : 'attend'); Audio_.setIntensity(.1); };
    showAnswer();
    const pending = askClaude(question, {
      onDelta: d => { if (!text && !consulting) opened(); text += d; renderReadout(text, false); speaker.push(text); },
      onEvent: label => { Audio_.sfx.blip(); if (consulting) return; stopPulse(); stopPulse = () => {}; line.textContent = String(label).toUpperCase().slice(0, 64); },
      signal: ac.signal,
    });
    const spoken = Voice.say(Dialogue.next(kind ? 'KIND_CONSULT' : 'CONSULT'), { hold: 0 }).then(() => { consulting = false; if (text) opened(); else stopPulse = pulseLine(Dialogue.next(kind ? 'KIND_WAIT' : 'WAIT')); speaker.start(); });
    try { answer = String(await pending); } catch (e) { answer = `${Dialogue.next(kind ? 'KIND_ERROR' : 'ERROR')} ${e && e.message ? e.message : e}`; }
    await spoken; currentAsk = null;
    if (answer !== text) { text = answer; renderReadout(text, false); speaker.push(text); }   // non-streamed answer, or a final answer that differs
    opened();
    await speaker.finish(text);
    renderReadout(text, true);
  }

  // the eye pays attention while you type, and mutters when ignored
  const rest = () => friendly ? 'friendly' : 'idle';
  q.addEventListener('focus', () => { if (!busy) Eye.setMood('attend'); });
  q.addEventListener('blur', () => { if (!busy && Eye.mood() === 'attend') Eye.setMood(rest()); });
  q.addEventListener('input', () => { lastActivity = performance.now(); if (busy) return; Eye.setMood('attend'); clearTimeout(attendTimer); attendTimer = setTimeout(() => { if (!busy && document.activeElement !== q) Eye.setMood(rest()); }, 2500); });
  addEventListener('pointerdown', () => { lastActivity = performance.now(); });
  setInterval(async () => {
    if (busy || document.hidden || Eye.mood() === 'sleep' || performance.now() - lastActivity < rnd(55000, 110000)) return;
    lastActivity = performance.now(); Eye.setMood('attend'); await Voice.say(Dialogue.next(friendly ? 'KIND_IDLE' : 'IDLE')); if (!busy) Eye.setMood(rest());
  }, 15000);

  // the hidden switch flips this; the eye's resting mood and the flow follow it
  function setFriendly(v) { friendly = !!v; if (!busy) Eye.setMood(rest()); }

  return { gate, hideAnswer, glitch, setFriendly, friendly: () => friendly, busy: () => busy, stats: () => ({ fails, wins }), touch: () => { lastActivity = performance.now(); } };
})();
