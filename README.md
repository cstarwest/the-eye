# Gatekeeper Eye

A single HTML file. A full-screen, dark, red eye guards a Claude session. Ask it something by typing or speaking; it taunts you in a low mechanical voice, drops you into a one-bit pixel game under a dark synth drone, and only answers if you win.

Everything is in `index.html`. There is no build step, no dependency, no audio file and no image: the eye, the voice layer, the music and the games are all generated in the browser.

## Running it

1. Open `index.html` in a browser (double-click works).
2. Tap once anywhere. Browsers require a tap before audio starts.
3. For the microphone, serve it over `localhost` or https (speech recognition refuses `file://`):

   ```sh
   npx serve .
   # or
   node server.mjs
   ```

   On a phone, open the served address on the same network, or drop the file on GitHub Pages / Netlify.

## Controls

| | |
|---|---|
| Type and press Enter, or ASK | ask the gatekeeper |
| MIC | speak the question (Chrome and Safari) |
| `/` | focus the input |
| Esc, or tap the readout | dismiss an answer |
| Drag, or ← → / A D | move in the games |
| Hold, or Space | fire (Purge the Swarm) |

## What happens

1. The eye wakes: lids open, the iris ignites, a drone swells.
2. Your question makes it angry. It taunts you, the screen tears, the drone intensifies.
3. One of three games starts at random (never the same one twice in a row):
   - **Breach the Wall** — brick breaker. The wall is shaped like an eye; the pupil takes two hits. Three balls.
   - **Purge the Swarm** — shoot 'em up. Twenty-four kills, three lives, waves that thicken as you score.
   - **Outrun the Static** — dodge falling static and sweeping bars for twenty seconds. One life.
4. Lose, and it mocks you (differently if you keep losing). Win, and it consults the session and reads the answer out, typing it into a readout panel.

Leave it alone long enough and it mutters at you.

## Wiring the real Claude

`askClaude(question)` in `index.html` is the only backend touchpoint. By default it is a mock oracle that answers in character. Two ways to make it real:

**Use the included bridge.** `server.mjs` is a dependency-free Node server that serves the page and exposes `POST /ask`, which runs `claude -p "<question>"` in a repository directory (Claude Code, headless):

```sh
REPO=/path/to/your/repo node server.mjs
# open http://localhost:3000
```

Options: `PORT` (default 3000), `REPO` (directory Claude Code runs in, default: current), `GATEKEEPER_SECRET` (if set, requests must send it in an `x-gatekeeper-key` header), `CLAUDE_BIN` (default `claude`).

**Or point the page at any server.** Add `?api=http://localhost:3000` to the URL (or set `CONFIG.api` at the top of the script). The page POSTs `{ question }` to `<api>/ask` and expects `{ answer }`. Add `&key=<secret>` to send the shared secret as `x-gatekeeper-key`. For remote or mobile use, put the server behind a tunnel (ngrok, Cloudflare Tunnel) and set the shared secret.

## Structure of the source

`index.html` is organised in sections, each a small module:

- **CONFIG** — the API endpoint, voice pitch and rate, reduced-motion detection.
- **AUDIO** — Web Audio only. Buses for music, sfx and voice; a convolver reverb built from generated noise; the drone (detuned saw and square oscillators through a resonant lowpass swept by a slow LFO, a breathing noise bed, a heartbeat whose tempo follows an `intensity` value, distant metallic hits); a combat bass pulse for the games; one-bit sound effects.
- **VOICE** — `speechSynthesis` pitched down, with a synthesized mechanical layer underneath (saw + square → tanh distortion → lowpass → flutter → reverb) that pulses on every word boundary, so it still reads as a machine where the pitch setting is ignored. Subtitles are typed in sync with the words. `SpeechRecognition` for the mic.
- **EYE** — layered canvas. Almond-shaped lids clip a dark sclera; veins flash on each heartbeat; the iris is a pre-rendered fibre texture in two counter-rotating layers so its noise drifts; the pupil tracks the pointer with saccades, dilates by mood and narrows to a slit when angry; bloom, film grain, scan tears and chromatic ghosting on top. Moods: sleep, waking, idle, attend, angry, judge, pleased, contempt, consult.
- **ARENA** — the one-bit games on a 160×240 logical canvas, letterboxed at an integer scale, with a 3×5 pixel font, particles, screen shake, inversion flashes and haptics.
- **BACKEND** — `askClaude`.
- **GATE** — the flow: taunt → glitch → game → verdict → consult → readout.
- **INPUT / WAKE** — wiring and the tap-to-wake sequence.

A console handle is exposed for poking at it: `GK.gate('question')`, `GK.eye.setMood('angry')`, `GK.arena.run(GK.arena.byName('swarm'))`, `GK.arena.end(true)` to force a win.

### Adding a game

Write an object with `name`, `brief`, `help` (`[touch hint, keyboard hint]`), `init()` returning a state, `step(state, dt)` returning `true` to win, `false` to lose or nothing to continue, and `draw(state)` using the one-bit helpers (`px`, `text`, `sprite`, `burst`, `flash`, `shake`), then add it to `GAMES`. If the state has `x` or `px`, the eye behind the arena will watch it.

### Adding lines

Append strings to `TAUNTS`, `LOSE`, `LOSE_AGAIN`, `WIN`, `WIN_STREAK`, `CONSULT` or `IDLE` in the GATE section.

## Known limits

- Speech recognition is Chrome and Safari only and needs https or localhost. The text field always works.
- Browser TTS cannot be routed through Web Audio, so the distortion and reverb run on a synthesized layer underneath it. Voice quality varies by OS; Windows and macOS have the deepest default voices. iOS may ignore the pitch setting, so the mechanical layer does most of the work there.
- Chrome desktop cuts long utterances after about fifteen seconds; the page nudges it, but very long answers may still clip.
