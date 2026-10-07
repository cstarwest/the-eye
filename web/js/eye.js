'use strict';
// ------------------------------- EYE ---------------------------------
// Layered canvas: almond-shaped lids clip a dark sclera with veins that flash
// on each heartbeat, a pre-rendered fibrous iris (two layers counter-rotating so
// the noise drifts), a pupil that tracks the pointer with saccades and goes to a
// slit when angry, glow bloom, film grain, scan tears, chromatic ghosting.
// Two tints: red, and the green it turns when the hidden switch is thrown;
// setTint() can flicker between them for a moment before settling.
const Eye = (() => {
  const cv = $('eye'), ctx = cv.getContext('2d');
  const TINTS = {
    red:   { name: 'red',   glow: [255, 0, 0],  hot: [255, 20, 0],  vein: [255, 40, 40], lid: [255, 30, 30], sclera: ['#1c0202', '#0c0000'], wave: '#ff1a1a',
             iris: ['#000', '#2a0000', '#c01010', '#6a0000', '#180000'], fibre: () => `${rnd(190, 255) | 0},${rnd(10, 70) | 0},${rnd(0, 40) | 0}` },
    green: { name: 'green', glow: [0, 255, 90], hot: [40, 255, 110], vein: [60, 255, 130], lid: [60, 255, 120], sclera: ['#021a0a', '#000c04'], wave: '#2bff7a',
             iris: ['#000', '#002a12', '#10c050', '#006a2a', '#00180a'], fibre: () => `${rnd(0, 50) | 0},${rnd(190, 255) | 0},${rnd(60, 150) | 0}` },
  };
  const col = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  let tintName = 'red', flickerUntil = 0, flickerFrom = 'red';
  const iris = {};                                   // tint name -> { a, b } pre-rendered layers
  const DPR = Math.min(devicePixelRatio || 1, 2);
  let W = 0, H = 0, R = 0, cx = 0, cy = 0, frame = 0, lastT = performance.now();
  let lx = 0, ly = 0, wander = { x: 0, y: 0 }, nextSacc = 2, saccUntil = 0, lookAt = null;
  let blinkStart = -10, nextBlink = 4, veins = [], grain = [], wbuf;
  const pointer = { x: 0, y: 0, has: false, t: 0 };
  const MOODS = {   // aperture: how open · slit: pupil shape · heat: redness/glow · flicker: instability · dilate: pupil size · gaze: 0 = eyes rolled up
    sleep:    { aperture: 0,    slit: 0,  heat: 0,   flicker: 0,   dilate: 0,  gaze: 1 },
    waking:   { aperture: .6,   slit: 0,  heat: .7,  flicker: 1,   dilate: .2, gaze: 1 },
    idle:     { aperture: 1,    slit: 0,  heat: .55, flicker: .25, dilate: .4, gaze: 1 },
    attend:   { aperture: 1.08, slit: 0,  heat: .7,  flicker: .3,  dilate: .75, gaze: 1 },
    angry:    { aperture: .74,  slit: 1,  heat: 1,   flicker: 1,   dilate: 0,  gaze: 1 },
    judge:    { aperture: .88,  slit: .6, heat: .85, flicker: .5,  dilate: .2, gaze: 1 },
    pleased:  { aperture: 1.14, slit: 0,  heat: .6,  flicker: .12, dilate: .95, gaze: 1 },
    contempt: { aperture: .5,   slit: .45, heat: .9, flicker: .6,  dilate: .1, gaze: 1 },
    consult:  { aperture: 1.04, slit: 0,  heat: .5,  flicker: .45, dilate: 1,  gaze: 0 },
    fear:     { aperture: 1.22, slit: .35, heat: 1,   flicker: 1,   dilate: .55, gaze: 1 },   // someone is at the panel
    friendly: { aperture: 1.12, slit: 0,  heat: .55, flicker: .04, dilate: .9, gaze: 1 },   // the switch holds
  };
  let moodName = 'sleep', target = MOODS.sleep, cur = { ...MOODS.sleep };

  function noiseTile(n, lo, hi) {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const x = c.getContext('2d'), img = x.createImageData(n, n), d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = lo + Math.random() * (hi - lo); d[i + 3] = 255; }
    x.putImageData(img, 0, 0); return c;
  }
  function makeIris(fibresOnly, T) {
    const S = 768, m = S / 2, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
    if (!fibresOnly) {
      const base = x.createRadialGradient(m, m, S * .06, m, m, m);
      [0, .3, .58, .8, 1].forEach((p, i) => base.addColorStop(p, T.iris[i]));
      x.fillStyle = base; x.fillRect(0, 0, S, S);
    }
    x.lineCap = 'round';
    for (let i = 0; i < (fibresOnly ? 260 : 460); i++) {
      const a = Math.random() * Math.PI * 2, r1 = S * rnd(.1, .22), r2 = S * rnd(.38, .5), bend = rnd(-.09, .09), rm = (r1 + r2) / 2;
      x.strokeStyle = `rgba(${T.fibre()},${rnd(.08, fibresOnly ? .5 : .35)})`; x.lineWidth = rnd(.6, 2.4);
      x.beginPath(); x.moveTo(m + Math.cos(a) * r1, m + Math.sin(a) * r1);
      x.quadraticCurveTo(m + Math.cos(a + bend) * rm, m + Math.sin(a + bend) * rm, m + Math.cos(a) * r2, m + Math.sin(a) * r2); x.stroke();
    }
    for (let i = 0; i < (fibresOnly ? 30 : 90); i++) {
      const a = Math.random() * Math.PI * 2, r = S * rnd(.2, .45);
      x.fillStyle = `rgba(0,0,0,${rnd(.2, .6)})`; x.beginPath(); x.ellipse(m + Math.cos(a) * r, m + Math.sin(a) * r, rnd(2, 9), rnd(6, 24), a, 0, Math.PI * 2); x.fill();
    }
    if (!fibresOnly) { x.globalCompositeOperation = 'multiply'; x.globalAlpha = .9; x.drawImage(noiseTile(96, 110, 255), 0, 0, S, S); x.globalAlpha = 1; }
    x.globalCompositeOperation = 'destination-in';
    const mask = x.createRadialGradient(m, m, 0, m, m, m);
    mask.addColorStop(.1, 'rgba(0,0,0,0)'); mask.addColorStop(.17, '#000'); mask.addColorStop(.92, '#000'); mask.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = mask; x.fillRect(0, 0, S, S);
    return c;
  }
  function makeVeins() {
    veins = [];
    const grow = (r0, a0, len, w, depth) => {
      const pts = [], curl = rnd(-.05, .05); let r = r0, a = a0;
      for (let i = 0; i < len && r > .66; i++) {
        pts.push({ x: Math.cos(a) * r * 1.45, y: Math.sin(a) * r }); r -= rnd(.03, .07); a += curl + rnd(-.05, .05);
        if (depth < 2 && Math.random() < .12) grow(r, a + rnd(-.7, .7), len - i, w * .6, depth + 1);
      }
      if (pts.length > 2) veins.push({ pts, w });
    };
    for (let i = 0; i < 16; i++) grow(rnd(1.6, 2.2), rnd(0, Math.PI * 2), rnd(14, 28), rnd(.7, 1.8), 0);
  }
  function ensureTint(name) { if (!iris[name]) iris[name] = { a: makeIris(false, TINTS[name]), b: makeIris(true, TINTS[name]) }; return iris[name]; }
  function build() {
    ensureTint('red'); makeVeins();
    grain = [0, 1, 2, 3].map(() => ctx.createPattern(noiseTile(96, 0, 255), 'repeat'));
  }
  function resize() { W = cv.width = Math.round(innerWidth * DPR); H = cv.height = Math.round(innerHeight * DPR); }
  addEventListener('resize', resize); resize();
  const onPointer = e => { pointer.x = (e.clientX / innerWidth - .5) * 2; pointer.y = (e.clientY / innerHeight - .5) * 2; pointer.has = true; pointer.t = performance.now(); };
  addEventListener('pointermove', onPointer); addEventListener('pointerdown', onPointer);

  function draw(now) {
    const t = now / 1000, dt = Math.min(.05, (now - lastT) / 1000); lastT = now; frame++;
    // this frame's tint: while a flicker runs, the old and new tints fight for the frame
    const T = TINTS[now < flickerUntil && Math.random() < .5 ? flickerFrom : tintName], irisSet = ensureTint(T.name);
    for (const k in cur) cur[k] = lerp(cur[k], target[k], Math.min(1, dt * (k === 'heat' ? 1.6 : 3)));
    // --- gaze
    let gx, gy;
    if (cur.gaze < .5) { gx = Math.sin(t * .9) * .25; gy = -.75; }
    else if (lookAt) { gx = lookAt.x; gy = lookAt.y; }
    else if (pointer.has && now - pointer.t < 3500) { gx = pointer.x; gy = pointer.y; }
    else if (document.activeElement === $('q')) { gx = 0; gy = .8; }
    else {
      if (t > nextSacc) { wander = Math.random() < .3 ? { x: 0, y: 0 } : { x: rnd(-.6, .6), y: rnd(-.45, .4) }; nextSacc = t + rnd(1.5, 5); saccUntil = t + .18; }
      gx = wander.x; gy = wander.y;
    }
    const k = t < saccUntil ? .45 : .09; lx += (gx - lx) * k; ly += (gy - ly) * k;
    // --- blink
    if (moodName !== 'sleep' && t > nextBlink) { blinkStart = t; nextBlink = t + (Math.random() < .2 ? .5 : rnd(2.5, 7)); }
    const bt = t - blinkStart, blink = clamp(bt < .09 ? bt / .09 : 1 - (bt - .09) / .17, 0, 1);
    // --- geometry
    R = Math.min(W, H) * .30 * (1 + Math.sin(t * .8) * .008); cx = W / 2; cy = H * .44 + Math.sin(t * .5) * H * .004;
    const open = cur.aperture * (1 - blink), EW = R * 1.75, top = R * 1.12 * open, bot = R * .9 * open;
    const ix = cx + lx * R * .3, iy = cy + ly * R * .2, ir = R * .62;
    const flick = clamp(1 - cur.flicker * (.08 + .06 * Math.sin(t * 13) + .1 * Math.sin(t * 2.3)) - (Math.random() < .02 * cur.flicker ? .35 : 0), .2, 1);
    const almond = () => {
      ctx.beginPath(); ctx.moveTo(cx - EW, cy + R * .02);
      ctx.quadraticCurveTo(cx - EW * .5, cy - top * 1.1, cx, cy - top); ctx.quadraticCurveTo(cx + EW * .5, cy - top * 1.1, cx + EW, cy + R * .02);
      ctx.quadraticCurveTo(cx + EW * .5, cy + bot * 1.05, cx, cy + bot); ctx.quadraticCurveTo(cx - EW * .5, cy + bot * 1.05, cx - EW, cy + R * .02); ctx.closePath();
    };
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H);
    if (open > .01) {
      ctx.save(); almond(); ctx.clip();
      // sclera + veins (veins flash with the heartbeat)
      const sc = ctx.createRadialGradient(ix, iy, R * .5, cx, cy, R * 1.9);
      sc.addColorStop(0, T.sclera[0]); sc.addColorStop(.5, T.sclera[1]); sc.addColorStop(1, '#000');
      ctx.fillStyle = sc; ctx.fillRect(cx - EW, cy - top - 2, EW * 2, top + bot + 4);
      const hb = clamp(1 - (now - Audio_.heart.at) / 320, 0, 1);
      ctx.lineCap = 'round';
      for (const v of veins) {
        ctx.strokeStyle = col(T.vein, .05 + (.1 + hb * .25) * cur.heat); ctx.lineWidth = v.w * DPR * (1 + hb * .35);
        const P = v.pts; ctx.beginPath(); ctx.moveTo(cx + P[0].x * R, cy + P[0].y * R);
        for (let i = 1; i < P.length - 1; i++) ctx.quadraticCurveTo(cx + P[i].x * R, cy + P[i].y * R, cx + (P[i].x + P[i + 1].x) / 2 * R, cy + (P[i].y + P[i + 1].y) / 2 * R);
        ctx.stroke();
      }
      // iris: two fibre layers counter-rotating
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(ix, iy, ir * .22, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(ix, iy); ctx.globalAlpha = flick; ctx.rotate(t * .03); ctx.drawImage(irisSet.a, -ir, -ir, ir * 2, ir * 2);
      ctx.rotate(-t * .08); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .55 * flick; ctx.drawImage(irisSet.b, -ir, -ir, ir * 2, ir * 2); ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const ht = ctx.createRadialGradient(ix, iy, ir * .25, ix, iy, ir); ht.addColorStop(0, col(T.hot, .28 * cur.heat * flick)); ht.addColorStop(1, col(T.glow, 0));
      ctx.fillStyle = ht; ctx.beginPath(); ctx.arc(ix, iy, ir, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      const lim = ctx.createRadialGradient(ix, iy, ir * .78, ix, iy, ir); lim.addColorStop(0, 'rgba(0,0,0,0)'); lim.addColorStop(1, 'rgba(0,0,0,.85)');
      ctx.fillStyle = lim; ctx.beginPath(); ctx.arc(ix, iy, ir, 0, Math.PI * 2); ctx.fill();
      // pupil: dilates with mood, slits when angry, trembles while speaking
      const pr = R * (.13 + cur.dilate * .07) * (1 + (Voice.speaking() ? Math.sin(t * 22) * .06 : 0));
      ctx.save(); ctx.shadowColor = '#000'; ctx.shadowBlur = R * .05; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(ix, iy, pr * (1 - cur.slit * .68), pr * (1 + cur.slit * 1.35), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.save(); ctx.globalAlpha = .16 + cur.heat * .08;
      const hl = ctx.createRadialGradient(ix - ir * .35, iy - ir * .4, 0, ix - ir * .35, iy - ir * .4, ir * .22); hl.addColorStop(0, '#fff'); hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl; ctx.fillRect(ix - ir, iy - ir, ir * 2, ir * 2); ctx.restore();
      ctx.restore();
      // lid edges
      almond(); ctx.lineWidth = R * .035; ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.stroke();
      ctx.save(); ctx.shadowBlur = R * .08; ctx.shadowColor = col(T.glow, .7); ctx.lineWidth = R * .01; ctx.strokeStyle = col(T.lid, .06 + cur.heat * .16); ctx.stroke(); ctx.restore();
    }
    // bloom
    ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(ix, iy, 0, ix, iy, R * 1.7);
    gl.addColorStop(0, col(T.glow, (.1 + .16 * cur.heat) * flick * clamp(open, 0, 1))); gl.addColorStop(1, col(T.glow, 0));
    ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    if (!CONFIG.reducedMotion) {
      if (cur.slit > .5) { ctx.save(); ctx.globalAlpha = .12 * cur.slit; ctx.globalCompositeOperation = 'screen'; ctx.drawImage(cv, Math.sin(t * 31) * 4 * DPR, 0); ctx.restore(); }
      if (Math.random() < .004 + cur.flicker * .02) { const y = rnd(0, H), h = rnd(3, 28) * DPR; ctx.drawImage(cv, 0, y, W, h, rnd(-24, 24) * DPR, y, W, h); }
    }
    ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = .14; ctx.fillStyle = grain[frame & 3]; ctx.fillRect(0, 0, W, H); ctx.restore();
    drawWave(now, T);
    requestAnimationFrame(draw);
  }

  const wv = $('wave'), wx = wv.getContext('2d');
  function drawWave(now, T) {
    const an = Audio_.analyser(), sp = Voice.speaking(), mid = wv.height / 2, n = 72;
    wx.clearRect(0, 0, wv.width, wv.height);
    wx.strokeStyle = T.wave; wx.lineWidth = 1.5; wx.shadowBlur = 8; wx.shadowColor = T.wave; wx.beginPath();
    let data = null;
    if (an && sp) { if (!wbuf || wbuf.length !== an.frequencyBinCount) wbuf = new Uint8Array(an.frequencyBinCount); an.getByteTimeDomainData(wbuf); data = wbuf; }
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * wv.width;
      let a = Math.sin(i * .3 + now / 900) * 1.2;
      if (sp) { a = (Math.sin(i * .7 + now / 60) * .5 + Math.random() - .5) * mid * .7; if (data) a = (data[(i * 3) % data.length] - 128) / 128 * mid * 1.8 + a * .35; }
      i ? wx.lineTo(x, mid + a) : wx.moveTo(x, mid + a);
    }
    wx.stroke();
  }

  let running = false;
  return {
    start() { if (running) return; running = true; build(); lastT = performance.now(); requestAnimationFrame(draw); },
    setMood(m) { moodName = m; target = MOODS[m] || MOODS.idle; },
    mood: () => moodName,
    look(p) { lookAt = p || null; },
    // setTint('green', 900): flicker between the tints for 900ms, then hold the new one
    setTint(name, flickerMs = 0) { if (!TINTS[name]) return; ensureTint(name); if (name !== tintName) { flickerFrom = tintName; tintName = name; flickerUntil = performance.now() + flickerMs; } },
    tint: () => tintName,
    flicker(ms) { flickerFrom = tintName === 'red' ? 'green' : 'red'; ensureTint(flickerFrom); flickerUntil = performance.now() + ms; },   // a glimpse of the other tint
    moods: Object.keys(MOODS),
    state: cur,
  };
})();
