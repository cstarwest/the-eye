'use strict';
// =====================================================================
//  GATEKEEPER — a red eye that guards a Claude session.
//  No build step: index.html loads these scripts in order, and each one
//  leaves a single object behind for the next (CONFIG, Audio_, Voice, Eye,
//  Arena, Gate, Setup, Switch). The order is in index.html.
// =====================================================================

// ------------------------------ CONFIG -------------------------------
const CONFIG = {
  // Point this at a server exposing POST /ask { question } -> { answer }
  // (see server.mjs). Leave null to use the built-in mock oracle.
  // Can also be set per visit with ?api=http://localhost:3000, or from the
  // setup panel (the faint gear, top-left), which remembers it.
  api: new URLSearchParams(location.search).get('api') || null,
  key: new URLSearchParams(location.search).get('key') || null,   // sent as x-gatekeeper-key when set
  session: (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).slice(0, 8),
  oracle: null,                                                    // label reported by the bridge's /health
  model: null,
  repo: null,
  linked: false,                                                   // true once a bridge has answered /health
  lastProbe: '',                                                   // what the last probe said, for the setup panel
  // where the auto-bridge looks, in order, after the page's own origin
  candidates: ['http://localhost:3000', 'http://127.0.0.1:3000'],
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
