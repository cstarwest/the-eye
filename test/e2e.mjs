// End-to-end in the desktop app itself (Electron, driven by Playwright):
//   1. no Claude Code on this machine: the mock answers, every game plays, the hidden panel
//   2. Claude Code installed (a stand-in CLI on PATH): found on its own, linked, answers stream
// On a Linux machine without a display, run it under xvfb-run:   xvfb-run -a npm run test:e2e
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, mkdtemp, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..'), OUT = join(here, 'shots');
await mkdir(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };

// A clean machine: its own user data, a HOME with nothing installed, no API key, no ORACLE,
// and a PATH holding only node plus whatever `extra` adds.
async function launch(name, extra = []) {
  const base = await mkdtemp(join(tmpdir(), `gk-e2e-${name}-`));
  const nodeDir = join(base, 'node'); await mkdir(nodeDir); await symlink(process.execPath, join(nodeDir, 'node'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC_|ORACLE$|CLAUDE_BIN$|REPO$|MODEL$)/.test(k)));
  Object.assign(env, { HOME: join(base, 'home'), GATEKEEPER_USER_DATA: join(base, 'user-data'), GATEKEEPER_SHELL_ENV: '0', PATH: [...extra, nodeDir, '/usr/bin', '/bin'].join(delimiter) });
  await mkdir(env.HOME);
  const args = [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '--autoplay-policy=no-user-gesture-required', root];
  const app = await electron.launch({ executablePath: electronPath, args, env, cwd: root });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  await page.waitForLoadState('domcontentloaded');
  return { app, page, base };
}

// Plays whichever game is running, competently but legally: the paddle games by moving
// the player (the state is live) away from whatever would hit it soonest, the sigil by
// pressing the arrows the sequence asks for.
async function autopilot(page, ms) {
  const t0 = Date.now();
  let lastKey = null;
  while (Date.now() - t0 < ms) {
    const key = await page.evaluate(() => {
      const s = GK.arena.current(); if (!s || s._endAt) return null;
      const W = 160, at = x => Math.max(0, Math.min(W - 8, x));
      if (s.balls) {
        const live = s.balls.filter(b => !b.lost), down = live.filter(b => b.vy > 0).sort((a, b) => b.y - a.y), b = down[0] || live.sort((a, b) => b.y - a.y)[0];
        if (b) s.px = Math.max(0, Math.min(W - s.pw, b.x + b.vx * .08 - s.pw / 2));
      }
      else if (s.foes) {
        let target = s.x; const f = s.foes.slice().sort((a, b) => b.y - a.y)[0]; if (f) target = at(f.x); if (s.boss) target = at(s.boss.x + 8);
        let best = s.x, score = -1e9;
        for (let x = 0; x <= W - 8; x += 2) {
          let t = 9;
          for (const p of s.eshots) { const ty = (218 - p.y) / p.vy; if (ty < -.05 || ty > 2.5) continue; const px = p.x + p.vx * Math.max(0, ty); if (px > x - 3 && px < x + 10) t = Math.min(t, Math.max(0, ty)); }
          for (const f of s.foes) { const ty = (212 - f.y) / (f.dive ? 130 : 60); if (ty < -.05 || ty > 2) continue; const fx = f.dive ? f.x + Math.sign(x - f.x) * Math.min(Math.abs(x - f.x), 80 * ty) : f.x + f.vx * ty; if (fx + 9 > x - 1 && fx < x + 9) t = Math.min(t, Math.max(0, ty)); }
          const sc = Math.min(t, 1.2) * 100 - Math.abs(x - target) * .4 - Math.abs(x - s.x) * .2; if (sc > score) { score = sc; best = x; }
        }
        s.x = best;
      }
      else if (s.rocks) {
        let best = s.x, score = -1e9;
        for (let x = 0; x <= W - 8; x += 2) {
          let t = 9;
          for (const r of s.rocks) if (r.x < x + 8 && r.x + r.w > x && r.y < 232) t = Math.min(t, Math.max(0, (218 - r.y) / r.v));
          for (const b of s.bars) if (b.y < 232 && (x < b.gap || x + 8 > b.gap + b.gw)) t = Math.min(t, Math.max(0, (221 - b.y) / b.v));
          for (const e of s.seekers) { if (e.y >= 232) continue; const ty = (216 - e.y) / e.vy; if (ty > .7) continue; if (Math.abs(x - e.x) < (e.y < 150 ? 58 + s.t * 2 : 0) * Math.max(0, ty) + 9) t = Math.min(t, Math.max(0, ty)); }
          for (const L of s.lashes) { const R = W / 2, reach = L.t < L.warn + .65 ? R : L.len; if (L.len > 0) { if (L.side > 0 ? x < reach + 2 : x + 8 > W - reach - 2) t = 0; } else if (L.t < L.warn && (L.side > 0 ? x < R : x + 8 > W - R)) t = Math.min(t, L.warn - L.t); }
          const sc = Math.min(t, 1.5) * 100 - Math.abs(x - s.x) * .15; if (sc > score) { score = sc; best = x; }
        }
        s.x = best;
      }
      else if (s.seq && s.phase === 'input') return { id: s.round * 100 + s.i, key: ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][s.seq[s.i]] };
      return null;
    });
    if (key && !(lastKey && lastKey.id === key.id && Date.now() - lastKey.at < 300)) { lastKey = { id: key.id, at: Date.now() }; await page.keyboard.press(key.key); }   // never the same rune twice before a frame has read it
    await sleep(40);
  }
}

// 1. no Claude Code installed: the app falls back to the mock on its own
{
  const { app, page } = await launch('mock');
  const sealed = await page.evaluate(() => ({ require: typeof require, process: typeof process, bridge: typeof window.gatekeeper }));
  if (sealed.require !== 'undefined' || sealed.process !== 'undefined' || sealed.bridge !== 'object') fail('the window should see the bridge and nothing of Node: ' + JSON.stringify(sealed));
  await page.click('#wake'); await sleep(2800);
  const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(n / 2); }; requestAnimationFrame(f); }));
  console.log('idle fps ~', fps.toFixed(0));
  await page.screenshot({ path: join(OUT, 'idle.png') });
  await page.fill('#q', 'where are the tests?'); await page.press('#q', 'Enter');
  await page.waitForSelector('#stage.on', { timeout: 15000 });
  console.log('game:', await page.textContent('#gtitle'));
  await sleep(2600); await page.screenshot({ path: join(OUT, 'game.png') });
  await page.evaluate(() => GK.arena.end(true));
  await page.waitForSelector('#answer.on', { timeout: 20000 });
  await page.waitForFunction(() => document.getElementById('abody').textContent.length > 40, null, { timeout: 30000 });
  const partial = await page.textContent('#abody');
  await page.screenshot({ path: join(OUT, 'streaming.png') });
  await page.waitForFunction(() => !document.getElementById('ask').disabled, null, { timeout: 90000 });
  await page.screenshot({ path: join(OUT, 'answer.png') });
  const text = await page.textContent('#abody'), stamp = await page.textContent('#astamp');
  if (!(partial.length < text.length)) fail('readout did not stream (partial ' + partial.length + ' vs ' + text.length + ')');
  if (!/214 tests/.test(text)) fail('mock answer missing: ' + text);
  if (!/^MOCK · SESSION/.test(stamp)) fail('stamp: ' + stamp);
  console.log('mock:', stamp, '|', text.slice(0, 60) + '…');
  const wonGame = await page.textContent('#gtitle'), skill1 = await page.evaluate(() => GK.arena.skill());
  if (!skill1[wonGame] || skill1[wonGame].tier !== 1 || skill1[wonGame].won !== 1) fail('the win did not raise that game\'s tier: ' + JSON.stringify(skill1));
  // lose path
  await page.fill('#q', 'why does the build fail?'); await page.click('#ask');
  await page.waitForSelector('#stage.on', { timeout: 15000 }); await sleep(2200);
  await page.evaluate(() => GK.arena.end(false));
  await page.waitForFunction(() => !document.getElementById('ask').disabled, null, { timeout: 30000 });
  console.log('after loss:', await page.textContent('#line'), await page.evaluate(() => GK.stats()));
  const lostGame = await page.textContent('#gtitle'), skill2 = await page.evaluate(() => GK.arena.skill());
  if (lostGame === wonGame) fail('the same game twice in a row');
  if (!skill2[lostGame] || skill2[lostGame].tier !== 0 || skill2[lostGame].lost !== 1) fail('the loss was not recorded: ' + JSON.stringify(skill2));
  if (await page.evaluate(() => JSON.parse(localStorage.getItem('gatekeeper.skill') || 'null') === null)) fail('skill is not kept in localStorage');
  console.log('skill:', JSON.stringify(skill2));
  // every game, at tier 2, under the autopilot for a moment (a trial is only a handful of seconds): no errors, and each one plays
  for (const name of await page.evaluate(() => GK.arena.GAMES.map(g => g.name))) {
    await page.evaluate(n => { window.__game = GK.arena.run(GK.arena.byName(n), 1); }, name);
    await page.waitForSelector('#stage.on', { timeout: 5000 });
    await page.keyboard.down('Space');
    await autopilot(page, 4000);
    await page.keyboard.up('Space');
    const st = await page.evaluate(() => { const s = GK.arena.current(); return s && { lvl: s.lvl, bricks: s.b && s.b.filter(k => k.hp).length, total: s.total, kills: s.kills, round: s.round, t: s.t, danger: s.danger, heat: s.heat }; });
    await page.screenshot({ path: join(OUT, `soak-${name.toLowerCase().replace(/ /g, '-')}.png`) });
    await page.evaluate(() => GK.arena.end(true));
    const won = await page.evaluate(() => window.__game);
    console.log('soak:', name, JSON.stringify(st), '->', won);
    if (!st) fail(name + ' ended on its own under the autopilot');
    else {
      if (st.lvl !== 1) fail(name + ' ignored the level');
      if (st.bricks !== undefined && st.bricks >= st.total) fail(name + ': the ball never hit a brick');
      if (st.kills !== undefined && !st.kills) fail(name + ': nothing was killed');
      if (st.round !== undefined && st.round < 2) fail(name + ': the first round was never recited');
    }
    if (won !== true) fail(name + ' did not resolve as a win when ended');
  }

  // the setup gear: opens the card; with no Claude Code the mock answers, and the dot is hollow
  await page.click('#setup-btn');
  await page.waitForSelector('#setup.on', { timeout: 3000 });
  const link0 = await page.textContent('#st-link'), claude0 = await page.textContent('#st-claude'), oracle0 = await page.textContent('#st-oracle');
  if (link0 !== 'NOT LINKED · MOCK ANSWERS' || claude0 !== 'not found' || oracle0 !== 'MOCK') fail(`setup without Claude Code: ${link0} / ${claude0} / ${oracle0}`);
  if (await page.getAttribute('#setup-btn', 'data-link') !== 'off') fail('gear dot should be off without Claude Code');
  if (await page.isVisible('#mic')) fail('MIC should be hidden in the desktop app');
  await page.screenshot({ path: join(OUT, 'setup-mock.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('setup').classList.contains('on'), null, { timeout: 3000 });

  // the hidden panel: eight taps free the screws, the plate swings open, the switch turns the eye green
  await page.evaluate(() => GK.switch.hold(7000));
  if (await page.getAttribute('#plate', 'data-corner') !== 'tr') fail('the panel should start top-right');
  for (let i = 0; i < 8; i++) { await page.click('#plate .door'); await sleep(130); }
  await page.waitForFunction(() => document.getElementById('plate').dataset.stage === 'open', null, { timeout: 5000 });
  const st1 = await page.evaluate(() => ({ ...GK.switch.state(), mood: GK.eye.mood(), line: document.getElementById('line').textContent }));
  if (st1.screw !== 4 || st1.taps !== 8) fail('screws: ' + JSON.stringify(st1));
  if (!['fear', 'angry'].includes(st1.mood)) fail('the eye should object to the panel, mood was ' + st1.mood);
  console.log('panel open:', st1.mood, JSON.stringify(st1.line));
  await page.screenshot({ path: join(OUT, 'panel-open.png') });
  await page.click('#switch');
  await page.waitForFunction(() => document.body.classList.contains('friendly') && GK.eye.tint() === 'green' && document.getElementById('switch').classList.contains('on'), null, { timeout: 5000 });
  const st2 = await page.evaluate(() => ({ friendly: GK.switch.friendly(), warm: GK.audio.warm(), tone: GK.voice.tone(), gate: GK.gate && true, stage: GK.switch.state().stage }));
  if (!(st2.friendly && st2.warm && st2.tone === 'kind' && st2.stage === 'on')) fail('friendly mode did not take: ' + JSON.stringify(st2));
  await sleep(2000); await page.screenshot({ path: join(OUT, 'friendly.png') });
  // friendly: no trial, the answer comes at once, and the stamp says so
  await page.evaluate(() => { window.__stageSeen = false; new MutationObserver(() => { if (document.getElementById('stage').classList.contains('on')) window.__stageSeen = true; }).observe(document.getElementById('stage'), { attributes: true }); });
  await page.fill('#q', 'where are the tests?'); await page.press('#q', 'Enter');
  await page.waitForSelector('#answer.on', { timeout: 20000 });
  await page.waitForFunction(() => !document.getElementById('ask').disabled, null, { timeout: 90000 });
  const kindStamp = await page.textContent('#astamp'), kindText = await page.textContent('#abody');
  if (await page.evaluate(() => window.__stageSeen)) fail('a trial ran while friendly');
  if (!/UNGATED/.test(kindStamp)) fail('friendly stamp: ' + kindStamp);
  if (!/214 tests/.test(kindText)) fail('friendly answer: ' + kindText);
  console.log('friendly:', kindStamp, '|', await page.textContent('#line'));
  // it does not last: the corruption takes it back and the panel hides in another corner
  await page.waitForFunction(() => !document.body.classList.contains('friendly') && GK.eye.tint() === 'red' && !GK.switch.friendly(), null, { timeout: 45000 });
  await page.waitForFunction(() => { const p = document.getElementById('plate'); return p.dataset.stage === 'hidden' && GK.switch.state().corner !== 'tr' && !p.classList.contains('gone'); }, null, { timeout: 20000 });
  const st3 = await page.evaluate(() => ({ ...GK.switch.state(), tone: GK.voice.tone(), warm: GK.audio.warm(), sw: document.getElementById('switch').className, body: document.body.className }));
  if (st3.tone !== 'demon' || st3.warm || st3.screw !== 0 || /on/.test(st3.sw) || /friendly|corrupting/.test(st3.body)) fail('corruption left state behind: ' + JSON.stringify(st3));
  console.log('corrupted; the panel is now', st3.corner);
  await page.waitForFunction(() => !document.getElementById('ask').disabled, null, { timeout: 20000 });
  await page.screenshot({ path: join(OUT, 'corrupted.png') });
  // the trials are back
  await page.fill('#q', 'how does auth work?'); await page.press('#q', 'Enter');
  await page.waitForSelector('#stage.on', { timeout: 15000 });
  await page.evaluate(() => GK.arena.end(false));
  await page.waitForFunction(() => !document.getElementById('ask').disabled, null, { timeout: 30000 });
  await app.close();
}

// 2. Claude Code installed: nothing to configure, the app finds it, links, and answers through it
{
  const binDir = await mkdtemp(join(tmpdir(), 'gk-e2e-bin-'));
  const fake = join(here, 'fixtures', 'fake-claude.mjs'); await chmod(fake, 0o755);
  await symlink(fake, join(binDir, 'claude'));
  const { app, page } = await launch('claude', [binDir]);
  await page.click('#wake'); await sleep(2800);
  await page.click('#setup-btn'); await page.waitForSelector('#setup.on', { timeout: 3000 });
  await page.waitForFunction(() => document.getElementById('st-link').textContent === 'LINKED', null, { timeout: 10000 }).catch(() => {});
  const link = await page.textContent('#st-link'), oracle = await page.textContent('#st-oracle'), claude = await page.textContent('#st-claude'), repo = await page.textContent('#st-repo');
  if (link !== 'LINKED' || oracle !== 'CLAUDE CODE' || !claude.includes('9.9.9') || !claude.includes(binDir) || repo !== root) fail(`setup with Claude Code: ${link} / ${oracle} / ${claude} / ${repo}`);
  if (await page.getAttribute('#setup-btn', 'data-link') !== 'on') fail('gear dot should be on when Claude Code is linked');
  await page.screenshot({ path: join(OUT, 'setup.png') });
  // FIND CLAUDE CODE looks again and finds the same one
  const r = await page.evaluate(() => GK.setup.autoBridge());
  if (!r || !r.ok || r.oracle !== 'CLAUDE CODE') fail('find again: ' + JSON.stringify(r));
  await page.keyboard.press('Escape');
  await page.fill('#q', 'where is the answer?'); await page.press('#q', 'Enter');
  await page.waitForSelector('#stage.on', { timeout: 15000 }); await sleep(1500);
  await page.evaluate(() => GK.arena.end(true));
  await page.waitForSelector('#answer.on', { timeout: 20000 });
  await page.waitForFunction(() => !document.getElementById('ask').disabled, null, { timeout: 90000 });
  const text = await page.textContent('#abody'), stamp = await page.textContent('#astamp');
  if (text !== 'The answer is forty-two. It lives in src/main.ts.') fail('Claude Code answer: ' + text);
  if (!/^CLAUDE CODE · SESSION/.test(stamp)) fail('Claude Code stamp: ' + stamp);
  console.log('claude code:', claude, '|', stamp, '|', text);
  await page.screenshot({ path: join(OUT, 'claude-answer.png') });
  await app.close();
}

console.log('errors:', errors.length ? errors : 'none');
if (errors.length) process.exitCode = 1;
