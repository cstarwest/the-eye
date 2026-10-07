// End-to-end in headless Chromium: the page on its own (mock in the browser)
// and the page served by the bridge with the mock oracle (streamed readout).
// Needs `npx playwright install chromium` once, or CHROMIUM=/path/to/chrome.   node test/e2e.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..'), OUT = join(here, 'shots');
await mkdir(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader'] });
const newPage = async () => { const p = await browser.newPage({ viewport: { width: 1280, height: 800 } }); p.on('pageerror', e => errors.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); }); return p; };
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };

// Plays whichever game is running, badly but legally: the paddle games by moving the
// player (the state is live), the sigil by pressing the arrows the sequence asks for.
async function autopilot(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const key = await page.evaluate(() => {
      const s = GK.arena.current(); if (!s) return null;
      const W = 160, at = x => Math.max(0, Math.min(W - 8, x));
      if (s.balls) { const b = s.balls.find(b => !b.lost); if (b) s.px = Math.max(0, Math.min(W - s.pw, b.x - s.pw / 2)); }
      else if (s.foes) { const f = s.foes.slice().sort((a, b) => b.y - a.y)[0]; if (f) s.x = at(f.x); }
      else if (s.rocks) {
        let best = s.x, score = -1;
        for (let x = 0; x <= W - 8; x += 4) {
          let t = 9;
          for (const r of s.rocks) if (r.x < x + 8 && r.x + r.w > x && r.y < 224) t = Math.min(t, (224 - r.y - 6) / r.v);
          for (const b of s.bars) if (b.y < 224 && (x < b.gap || x + 8 > b.gap + b.gw)) t = Math.min(t, (224 - b.y) / b.v);
          const sc = t - Math.abs(x - s.x) / 400; if (sc > score) { score = sc; best = x; }
        }
        s.x = best;
      }
      else if (s.seq && s.phase === 'input') return ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][s.seq[s.i]];
      return null;
    });
    if (key) await page.keyboard.press(key);
    await sleep(60);
  }
}

// 1. the page alone: wake, ask, win, read
{
  const page = await newPage();
  await page.goto('file://' + join(root, 'index.html'));
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
  await page.waitForFunction(() => !document.getElementById('ask').disabled, null, { timeout: 90000 });
  await page.screenshot({ path: join(OUT, 'answer.png') });
  const text = await page.textContent('#abody'), stamp = await page.textContent('#astamp');
  if (!/214 tests/.test(text)) fail('mock answer missing: ' + text);
  if (!/^MOCK · SESSION/.test(stamp)) fail('stamp: ' + stamp);
  console.log('standalone:', stamp, '|', text.slice(0, 60) + '…');
  // lose path
  await page.fill('#q', 'why does the build fail?'); await page.click('#ask');
  await page.waitForSelector('#stage.on', { timeout: 15000 }); await sleep(2200);
  await page.evaluate(() => GK.arena.end(false));
  await page.waitForFunction(() => !document.getElementById('ask').disabled, null, { timeout: 30000 });
  console.log('after loss:', await page.textContent('#line'), await page.evaluate(() => GK.stats()));
  // every game, at tier 2, under the autopilot for a few seconds: no errors, and each one plays
  for (const name of await page.evaluate(() => GK.arena.GAMES.map(g => g.name))) {
    await page.evaluate(n => { window.__game = GK.arena.run(GK.arena.byName(n), 1); }, name);
    await page.waitForSelector('#stage.on', { timeout: 5000 });
    await page.keyboard.down('Space');
    await autopilot(page, 6500);
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
  await page.close();
}

// 2. served by the bridge (mock oracle): bridge detected, readout streamed
{
  const port = 3900 + Math.floor(Math.random() * 90);
  const server = spawn(process.execPath, [join(root, 'server.mjs')], { env: { ...process.env, ORACLE: 'mock', PORT: String(port), REPO: root }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => server.stdout.on('data', d => { if (/gatekeeper on/.test(d)) r(); }));
  try {
    const page = await newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.click('#wake'); await sleep(2800);
    await page.fill('#q', 'how does auth work?'); await page.press('#q', 'Enter');
    await page.waitForSelector('#stage.on', { timeout: 15000 }); await sleep(2200);
    await page.evaluate(() => GK.arena.end(true));
    await page.waitForSelector('#answer.on', { timeout: 20000 });
    await page.waitForFunction(() => document.getElementById('abody').textContent.length > 40, null, { timeout: 30000 });
    const partial = await page.textContent('#abody'), lineDuring = await page.textContent('#line');
    await page.screenshot({ path: join(OUT, 'streaming.png') });
    await page.waitForFunction(() => !document.getElementById('ask').disabled, null, { timeout: 90000 });
    const text = await page.textContent('#abody'), stamp = await page.textContent('#astamp');
    if (!(partial.length < text.length)) fail('readout did not stream (partial ' + partial.length + ' vs ' + text.length + ')');
    if (!/src\/auth/.test(text)) fail('bridge answer missing: ' + text);
    if (!/^MOCK · SESSION/.test(stamp)) fail('bridge stamp: ' + stamp);
    console.log('bridge:', stamp, '| line during stream:', JSON.stringify(lineDuring), '|', text.slice(0, 50) + '…');
    await page.close();
  } finally { server.kill(); }
}

console.log('errors:', errors.length ? errors : 'none');
if (errors.length) process.exitCode = 1;
await browser.close();
