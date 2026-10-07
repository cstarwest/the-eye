'use strict';
// ------------------------------- INPUT -------------------------------
// Typing, the ASK and MIC buttons, keyboard shortcuts.
{
  const q = $('q'), mic = $('mic');
  $('ask').onclick = () => Gate.gate(q.value);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') Gate.gate(q.value); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape') { Gate.hideAnswer(); Setup.show(false); }
    if (e.key === '/' && document.activeElement !== q && !Gate.busy() && !Setup.isOpen()) { e.preventDefault(); q.focus(); }
  });
  $('answer').addEventListener('click', Gate.hideAnswer);
  if (!Voice.canListen) mic.style.display = 'none';
  else mic.onclick = async () => {
    if (Gate.busy() || mic.classList.contains('live')) return;
    mic.classList.add('live'); Eye.setMood('attend'); Audio_.sfx.blip();
    await Voice.say(Gate.friendly() ? 'Go ahead.' : 'Speak.', { hold: 0 });
    const heard = await Voice.listen(t => { q.value = t; });
    mic.classList.remove('live');
    if (heard) { q.value = heard; Gate.gate(heard); }
    else { await Voice.say(Gate.friendly() ? 'I did not catch that. Try again?' : 'I heard nothing.'); if (!Gate.busy()) Eye.setMood(Gate.friendly() ? 'friendly' : 'idle'); }
  };
}
