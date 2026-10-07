// End-to-end in headless Chromium: the page on its own (mock in the browser)
// and the page served by the bridge with the mock oracle (streamed readout).
// Needs `npx playwright install chromium` once.   node test/e2e.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..'), OUT = join(here, 'shots');
await mkdir(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader'] });
const newPage = async () => { const p = await browser.newPage({ viewport: { width: 1280, height: 800 } }); p.on('pageerror', e => errors.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); }); return p; };
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };

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
