'use strict';
// =====================================================================
//  GATEKEEPER — a red eye that guards a Claude session.
//  No build step: index.html loads these scripts in order, and each one
//  leaves a single object behind for the next (CONFIG, Audio_, Voice, Eye,
//  Arena, Gate, Setup, Switch). The order is in index.html.
// =====================================================================

// ------------------------------ CONFIG -------------------------------
const CONFIG = {
  // The bridge lives in the desktop app's main process (desktop/bridge.mjs) and
  // is reached through window.gatekeeper, which desktop/preload.cjs provides.
  // These mirror what it last reported; the setup card (the faint gear) shows them.
  desktop: !!window.gatekeeper,
  session: (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).slice(0, 8),
  oracle: null,                                                    // CLAUDE CODE, API or MOCK
  model: null,
  repo: null,                                                      // the repository's folder name
  repoPath: null,
  claude: null,                                                    // { path, version } of the Claude Code it found
  linked: false,                                                   // true when a real Claude answers (not the mock)
  needsRepo: false,                                                // a repository has to be chosen first
  ready: false,                                                    // the bridge has an oracle that can answer
  lastProbe: '',                                                   // what the bridge last said about itself
  voice: { pitch: 0.15, rate: 0.8 },      // as deep as the engine allows; the demon layer underneath does the rest
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
};
const $ = id => document.getElementById(id);
const pick = a => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wait = ms => new Promise(r => setTimeout(r, ms));
const buzz = pattern => { try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) {} };
// A tiny event bus, so the modules can react to each other without knowing each other.
const Bus = (() => {
  const subs = {};
  return {
    on(ev, fn) { (subs[ev] || (subs[ev] = [])).push(fn); return () => { subs[ev] = subs[ev].filter(f => f !== fn); }; },
    emit(ev, data) { (subs[ev] || []).slice().forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },
  };
})();
