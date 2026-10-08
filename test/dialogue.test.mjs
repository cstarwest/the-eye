import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('web/js/dialogue.js', root), 'utf8');
const consumers = {
  gate: ['TAUNTS', 'LOSE', 'LOSE_AGAIN', 'WIN', 'WIN_STREAK', 'CONSULT', 'IDLE', 'KIND_YES', 'KIND_CONSULT', 'KIND_IDLE', 'ERROR', 'KIND_ERROR', 'OPEN', 'KIND_OPEN', 'WAIT', 'KIND_WAIT'],
  switch: ['LOOSEN', 'OPENED', 'FRIENDLY', 'FRIENDLY_THEN', 'WANING', 'CORRUPT', 'RELOCATED'],
  input: ['LISTEN', 'KIND_LISTEN', 'UNHEARD', 'KIND_UNHEARD'],
  main: ['WAKE'],
};
const names = Object.values(consumers).flat();

// The production file is a classic browser script. Evaluate it as one, without
// adding exports or a DOM dependency just for tests. Each load owns fresh bags.
function loadDialogue(random = () => 0.5) {
  const math = Object.create(Math);
  math.random = random;
  return runInNewContext(`${source}\nDialogue;`, { Math: math }, { filename: 'dialogue.js', timeout: 1000 });
}

function seededRandom(seed = 0x12345678) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function entries(dialogue) {
  return Object.entries(dialogue.banks).flatMap(([name, bank]) => name === 'LOOSEN'
    ? Array.from(bank, (lines, stage) => ({ name, stage, lines, label: `${name}[${stage}]` }))
    : [{ name, stage: undefined, lines: bank, label: name }]);
}

function draw(dialogue, { name, stage }) {
  return stage === undefined ? dialogue.next(name) : dialogue.next(name, stage);
}

test('dialogue exposes every event bank, including eight distinct loosening stages', () => {
  const dialogue = loadDialogue();
  assert.equal(typeof dialogue.next, 'function');
  assert.deepEqual(Object.keys(dialogue.banks).sort(), names.slice().sort());
  assert.equal(dialogue.banks.LOOSEN.length, 8);
  for (const lines of dialogue.banks.LOOSEN) assert.equal(lines.length, 3);

  for (const { lines, label } of entries(dialogue)) {
    assert.ok(Array.isArray(lines), `${label} is an array`);
    assert.ok(lines.length >= 3, `${label} has multiple options`);
    for (const line of lines) {
      assert.equal(typeof line, 'string', `${label} contains speech strings`);
      assert.equal(line, line.trim(), `${label} has no leading or trailing whitespace`);
      assert.match(line, /\p{L}/u, `${label} contains actual words`);
      assert.doesNotMatch(line, /[\x00-\x1f\x7f<>`]|\*\*|\[[^\]]+\]\(/, `${label} is plain speech, not markup`);
    }
    const normalized = Array.from(lines, line => line.toLowerCase().replace(/\s+/g, ' '));
    assert.equal(new Set(normalized).size, lines.length, `${label} has no duplicate options`);
  }
});

test('dialogue banks and nested stages cannot be mutated by consumers', () => {
  const dialogue = loadDialogue();
  assert.ok(Object.isFrozen(dialogue.banks));
  for (const [name, bank] of Object.entries(dialogue.banks)) {
    assert.ok(Object.isFrozen(bank), `${name} is frozen`);
    assert.throws(() => { bank[0] = 'changed'; }, TypeError);
    assert.throws(() => { bank.push('changed'); });
  }
  for (const { lines, label } of entries(dialogue)) {
    assert.ok(Object.isFrozen(lines), `${label} is frozen`);
    assert.throws(() => { lines[0] = 'changed'; }, TypeError);
  }
  assert.throws(() => { dialogue.banks.NEW_BANK = ['changed']; }, TypeError);
});

for (const [label, random] of [
  ['random = 0', () => 0],
  ['random = 0.5', () => 0.5],
  ['random approaching 1', () => 1 - Number.EPSILON],
  ['seeded random', seededRandom()],
]) {
  test(`dialogue uses every option before refill and never repeats across its boundary (${label})`, () => {
    const dialogue = loadDialogue(random);
    for (const entry of entries(dialogue)) {
      const expected = Array.from(entry.lines).sort();
      let previous;
      for (let cycle = 0; cycle < 20; cycle++) {
        const seen = [];
        for (let index = 0; index < entry.lines.length; index++) {
          const line = draw(dialogue, entry);
          assert.ok(entry.lines.includes(line), `${entry.label} returns an in-bounds option`);
          if (entry.lines.length > 1) assert.notEqual(line, previous, `${entry.label} repeated at cycle ${cycle}, draw ${index}`);
          seen.push(line);
          previous = line;
        }
        assert.deepEqual(seen.sort(), expected, `${entry.label} cycle ${cycle} visits each option exactly once`);
      }
    }
  });
}

test('each event bank and loosening stage keeps an independent shuffle bag', () => {
  // A constant RNG means other banks cannot change the random input; any
  // sequence difference here means their bag/cursor/last-line state leaked.
  const random = () => 0.37;
  const mixed = loadDialogue(random);
  const banks = entries(mixed);
  const references = banks.map(() => loadDialogue(random));
  for (let round = 0; round < 20; round++) {
    for (let index = 0; index < banks.length; index++) {
      const entry = banks[index];
      const count = 1 + ((round + index) % 4);
      for (let drawIndex = 0; drawIndex < count; drawIndex++) {
        assert.equal(draw(mixed, entry), draw(references[index], entry), `${entry.label} changed after interleaving other banks`);
      }
    }
  }
});

test('invalid dialogue banks and loosening stages fail explicitly without consuming valid options', () => {
  const dialogue = loadDialogue();
  const reference = loadDialogue();
  for (const name of ['MISSING', '', 'constructor', 'toString', '__proto__', undefined, null, 0]) {
    assert.throws(() => dialogue.next(name), undefined, `unknown bank ${String(name)} must throw`);
  }
  for (const stage of [undefined, null, -1, 8, 100, 0.5, '0', NaN, Infinity, -Infinity]) {
    assert.throws(() => dialogue.next('LOOSEN', stage), undefined, `invalid stage ${String(stage)} must throw`);
  }
  for (const name of names.filter(name => name !== 'LOOSEN')) {
    assert.throws(() => dialogue.next(name, 0), undefined, `${name} has no stages`);
  }
  for (const entry of entries(dialogue)) {
    for (let index = 0; index < entry.lines.length + 1; index++) {
      assert.equal(draw(dialogue, entry), draw(reference, entry), `${entry.label} was changed by a rejected request`);
    }
  }
});

// Extract balanced call arguments so both next('NAME') and
// next(Gate.friendly() ? 'KIND_NAME' : 'NAME') are checked, without dictating
// which equivalent conditional style a consumer must use.
function dialogueArguments(text) {
  return [...text.matchAll(/\bDialogue\.next\s*\(/g)].map(match => {
    const start = match.index + match[0].length;
    let depth = 1, quote = null, escaped = false;
    for (let index = start; index < text.length; index++) {
      const ch = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) return text.slice(start, index);
    }
    assert.fail('Unclosed Dialogue.next call');
  });
}

test('gate, switch, microphone and wake flows consume their centralized dialogue banks', async () => {
  for (const [consumer, expected] of Object.entries(consumers)) {
    const text = await readFile(new URL(`web/js/${consumer}.js`, root), 'utf8');
    const arguments_ = dialogueArguments(text);
    const referenced = new Set(arguments_.flatMap(argument => [...argument.matchAll(/['"]([A-Z_]+)['"]/g)].map(match => match[1])));
    assert.deepEqual([...referenced].sort(), expected.slice().sort(), `${consumer} maps all its dialogue events to the library`);
    for (const name of expected) {
      assert.doesNotMatch(text, new RegExp(`\\bconst\\s+${name}\\s*=`), `${consumer} must not keep its own ${name} bank`);
    }
    if (consumer === 'switch') {
      assert.ok(arguments_.some(argument => /['"]LOOSEN['"]\s*,/.test(argument) && /taps/.test(argument)), 'loosening selects the bank for the current tap stage');
    }
  }
});

test('the classic dialogue script loads once, before every dialogue consumer', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>/g)];
  const paths = scripts.map(match => match[2]);
  const dialogueIndex = paths.indexOf('web/js/dialogue.js');
  assert.notEqual(dialogueIndex, -1, 'dialogue.js is included');
  assert.equal(paths.filter(path => path === 'web/js/dialogue.js').length, 1);
  const attributes = scripts[dialogueIndex][1] + scripts[dialogueIndex][3];
  assert.doesNotMatch(attributes, /\btype\s*=\s*['"]module['"]|\basync\b|\bdefer\b/, 'dialogue loads synchronously as a classic script');
  for (const consumer of Object.keys(consumers)) {
    const index = paths.indexOf(`web/js/${consumer}.js`);
    assert.ok(index > dialogueIndex, `dialogue must load before ${consumer}`);
  }
});

const gateSource = await readFile(new URL('web/js/gate.js', root), 'utf8');

function gateHarness({ outcomes = [], answer = 'The oracle answered.', oracle } = {}) {
  const elements = new Map(), selections = [], speech = [], questions = [], trials = [];
  const noop = () => {};
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        textContent: '', value: '', disabled: false,
        classList: { add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)), contains: value => classes.has(value) },
        addEventListener: noop, appendChild: noop, blur: noop,
      });
    }
    return elements.get(id);
  }
  const dialogue = loadDialogue(() => 0.5);
  let mood = 'idle', timerId = 0;
  const context = {
    $: element,
    Dialogue: { next(name, stage) { const text = dialogue.next(name, stage); selections.push({ name, stage, text }); return text; } },
    Voice: { async say(text, options = {}) { speech.push({ text, options }); } },
    Eye: { setMood(value) { mood = value; }, mood: () => mood, look: noop },
    Audio_: { sfx: { glitch: noop, blip: noop, thud: noop, lose: noop }, setIntensity: noop, startBeat: noop, stopBeat: noop },
    Arena: { async trial() { const result = outcomes[trials.length]; trials.push(result); return result; } },
    CONFIG: { oracle: 'synthetic', session: 'test-session' },
    askClaude(question, callbacks) { questions.push({ question, callbacks }); return oracle ? oracle(question, callbacks) : Promise.resolve(answer); },
    document: { hidden: false, activeElement: null, createElement: () => ({}) },
    performance: { now: () => 0 },
    addEventListener: noop,
    wait: async () => {}, buzz: noop, rnd: () => 55000,
    setInterval: () => ++timerId, clearInterval: noop,
    setTimeout: () => ++timerId, clearTimeout: noop,
    AbortController,
  };
  const gate = runInNewContext(`${gateSource}\nGate;`, context, { filename: 'gate.js', timeout: 1000 });
  return { gate, dialogue, element, selections, speech, questions, trials };
}

test('friendly gate skips the trial, uses kind dialogue and preserves streamed oracle text exactly', async () => {
  let reportRequest, completeAnswer;
  const requested = new Promise(resolve => { reportRequest = resolve; });
  const pendingAnswer = new Promise(resolve => { completeAnswer = resolve; });
  const h = gateHarness({ oracle: (_question, callbacks) => { reportRequest(callbacks); return pendingAnswer; } });
  h.gate.setFriendly(true);
  const running = h.gate.gate('  Explain the repository.  ');
  const callbacks = await requested;
  await Promise.resolve();
  assert.equal(h.gate.busy(), true);
  assert.equal(h.element('q').disabled, true);
  assert.deepEqual(h.trials, [], 'friendly mode never launches a game');
  assert.equal(h.questions[0].question, 'Explain the repository.');
  assert.ok(callbacks.signal instanceof AbortSignal);
  assert.ok(h.dialogue.banks.KIND_WAIT.includes(h.element('line').textContent));
  assert.deepEqual(h.speech.filter(item => !item.options.silent).map(item => item.text),
    h.selections.filter(item => ['KIND_YES', 'KIND_CONSULT'].includes(item.name)).map(item => item.text));

  await h.gate.gate('Do not start a second request.');
  assert.equal(h.questions.length, 1, 'busy gate ignores a second request');
  const chunks = ['  First sentence.\n\n', 'Unicode: café, λ, and 🗝.\n', '<literal markup> stays literal.  '];
  for (const chunk of chunks) callbacks.onDelta(chunk);
  const openLine = h.element('line').textContent;
  assert.ok(h.dialogue.banks.KIND_OPEN.includes(openLine));
  const answer = chunks.join('');
  completeAnswer(answer);
  await running;
  assert.equal(h.element('abody').textContent, answer, 'dialogue does not rewrite, prepend to, or trim the readout');
  assert.equal(h.element('line').textContent, openLine, 'one answer keeps one selected open label');
  assert.equal(h.selections.filter(item => item.name === 'KIND_OPEN').length, 1);
  assert.ok(h.selections.every(item => item.name.startsWith('KIND_')), 'friendly flow never borrows corrupted dialogue');
  assert.equal(h.gate.busy(), false);
  for (const id of ['q', 'ask', 'mic']) assert.equal(h.element(id).disabled, false);
  assert.deepEqual({ ...h.gate.stats() }, { fails: 0, wins: 0 });
});

test('corrupted gate selects first/repeated loss and win banks without changing trial or oracle gating', async () => {
  const h = gateHarness({ outcomes: [false, false, true, true, false], answer: 'An unchanged oracle result.' });
  const expected = ['LOSE', 'LOSE_AGAIN', 'WIN', 'WIN_STREAK', 'LOSE'];
  for (let index = 0; index < expected.length; index++) {
    const start = h.selections.length;
    await h.gate.gate(`Question ${index + 1}`);
    const selected = h.selections.slice(start).map(item => item.name);
    assert.equal(selected[0], 'TAUNTS');
    assert.equal(selected[1], expected[index]);
    assert.ok(selected.every(name => !name.startsWith('KIND_')));
    assert.equal(selected.includes('CONSULT'), index === 2 || index === 3);
    assert.equal(h.gate.busy(), false);
  }
  assert.equal(h.trials.length, 5);
  assert.deepEqual(h.questions.map(item => item.question), ['Question 3', 'Question 4']);
  assert.equal(h.element('abody').textContent, 'An unchanged oracle result.');
  assert.deepEqual({ ...h.gate.stats() }, { fails: 1, wins: 2 });
});

test('oracle failures use the matching persona prefix and retain the original error detail', async () => {
  for (const friendly of [false, true]) {
    const detail = 'Synthetic connection failure: E_TEST (attempt 7).';
    const h = gateHarness({ outcomes: [true], oracle: async () => { throw new Error(detail); } });
    h.gate.setFriendly(friendly);
    await h.gate.gate('Trigger a synthetic error.');
    const errors = h.selections.filter(item => /ERROR$/.test(item.name));
    assert.equal(errors.length, 1);
    assert.equal(errors[0].name, friendly ? 'KIND_ERROR' : 'ERROR');
    assert.equal(h.element('abody').textContent, `${errors[0].text} ${detail}`);
    assert.equal(h.gate.busy(), false);
    for (const id of ['q', 'ask', 'mic']) assert.equal(h.element(id).disabled, false);
  }
});

test('empty questions do not consume dialogue, start trials or call the oracle', async () => {
  const h = gateHarness();
  for (const question of ['', '   ', '\n\t', undefined]) await h.gate.gate(question);
  assert.deepEqual(h.selections, []);
  assert.deepEqual(h.trials, []);
  assert.deepEqual(h.questions, []);
  assert.equal(h.gate.busy(), false);
});
