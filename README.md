# Gatekeeper Eye

A full-screen, dark, red eye guards a Claude session. Ask it something by typing or speaking; it taunts you in a deep, distorted voice, drops you into a one-bit pixel game under a dark synth drone and a driving beat, and only answers if you win. A trial is a handful of seconds, enough for a few meaningful moves, and each game remembers how often you have beaten it and tightens a little every time. When it answers, it is really reading your repository: through Claude Code or the Claude API, with MCP servers if you have them.

The page is plain HTML, CSS and scripts with no build step, no dependency, no audio file and no image: the eye, the voice layer, the music and the games are all generated in the browser. The bridge that connects it to Claude is a small Node server.

Somewhere on the page there is a panel that was not meant to be opened.

## Quick start

```sh
npm install
node server.mjs            # serves the page and picks an oracle (see below)
# open http://localhost:3000 and tap once
```

Without a bridge, the page still works on its own: open `index.html` directly and a mock oracle answers in character.

### The gear

A very faint gear sits in the top-left corner once the eye is awake. It opens the setup card: whether the page is bridged to a real Claude (the gear's dot is filled when it is, hollow when the mock answers), which oracle, model and repository the bridge reports, the session id, and what the last probe said. At the top of the card, **BRIDGE TO CLAUDE** finds a bridge on its own: the page's own origin first, then `localhost:3000` and `127.0.0.1:3000`. Below it you can enter any other bridge address and its secret; a bridge connected this way is remembered in the browser and probed again on the next visit. The rest of the card is the short version of this README: how to start a bridge and pick an oracle.

## The oracles

The bridge answers `POST /ask` through one of three oracles. It picks one automatically, or set `ORACLE=`:

| Oracle | What answers | Needs |
|---|---|---|
| `claude-code` | `claude -p` running headlessly in your repository, with its own tools (Read, Glob, Grep, read-only git), resumed between questions so it remembers the conversation | [Claude Code](https://claude.ai/code) installed and logged in |
| `api` | The Claude API (`claude-opus-5-5`, streaming, adaptive thinking, server-side refusal fallback) with built-in read-only repository tools and your MCP servers | `ANTHROPIC_API_KEY`, or `ant auth login` |
| `mock` | Canned answers, no model | nothing |

Auto-pick: `api` when `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_PROFILE` is set; else `claude-code` when `claude` is on the PATH; else `mock`.

```sh
REPO=/path/to/your/repo node server.mjs                       # Claude Code reads that repo
ORACLE=api ANTHROPIC_API_KEY=sk-ant-... REPO=/path node server.mjs
```

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | |
| `REPO` | current directory | the repository the gatekeeper reads |
| `GATEKEEPER_SECRET` | unset | when set, requests must carry it in an `x-gatekeeper-key` header (the page sends `?key=`) |
| `ORACLE` | auto | `claude-code`, `api` or `mock` |
| `MODEL` | Claude Code's default / `claude-opus-5-5` | model for the chosen oracle |
| `EFFORT` | `medium` | `api` only: `low`, `medium`, `high`, `xhigh`, `max` |
| `MAX_TURNS` | `12` | tool-use turns per question |
| `MCP_CONFIG` | `./mcp.json` if present | MCP servers (see below) |
| `COMPACT` | off | `api` only: `1` enables server-side compaction of long conversations instead of starting over |
| `CLAUDE_BIN` | `claude` | path to the Claude Code CLI |
| `CLAUDE_TOOLS` | `Read Glob Grep Bash(git log:*) …` | `claude-code` only: `--allowedTools` list |
| `CLAUDE_PERMISSION_MODE` | unset | `claude-code` only: passed as `--permission-mode` |
| `TIMEOUT_MS` | `300000` | `claude-code` only: per-question limit |

### MCP

Put an `mcp.json` next to the server (or point `MCP_CONFIG` at one) in the format Claude Desktop and Claude Code use; `mcp.example.json` shows it.

- `claude-code`: the file is passed straight to Claude Code with `--mcp-config`, and its tools are used as usual.
- `api`: servers with a `command` are started by the bridge over stdio (MCP SDK) and their tools are offered to Claude alongside the repository tools; servers with a `url` are handed to the API's MCP connector, which connects to them server-side.

### The protocol

`GET /health` → `{ gatekeeper: true, oracle, model, repo }`. The page probes this on its own origin when it wakes, so a page served by the bridge is live automatically. A page served from elsewhere can point at a bridge with `?api=http://localhost:3000` (and `&key=…` when a secret is set), or through the gear. The bridge also serves the page's own files under `/web/`; nothing else on disk is reachable.

`POST /ask` with `{ question, session }`. With `Accept: text/event-stream` the answer streams as server-sent events: `tool` / `status` (what the oracle is doing, shown under the eye), `delta` (text, typed into the readout and spoken sentence by sentence as it arrives), then `done { answer }` or `error { message }`. Without it, plain JSON `{ answer }`.

For remote or mobile use, put the bridge behind a tunnel (ngrok, Cloudflare Tunnel) and set `GATEKEEPER_SECRET`.

## Controls

| | |
|---|---|
| Type and press Enter, or ASK | ask the gatekeeper |
| MIC | speak the question (Chrome and Safari, https or localhost) |
| `/` | focus the input |
| Esc, or tap the readout | dismiss an answer (Esc also closes the setup card) |
| the faint gear, top-left | setup: bridge status, auto-bridge, instructions |
| Drag, or ← → / A D | move in the games |
| Hold, or Space | fire (Purge the Swarm) |
| Tap a rune, or ↑ → ↓ ← / W D S A | recite (Recite the Sigil) |

## What happens

1. The eye wakes: lids open, the iris ignites, a drone swells.
2. Your question makes it angry. It taunts you, the screen tears, the drone intensifies.
3. One of four games starts at random (never the same one twice in a row). A trial is built to fit between two thoughts at work: a handful of seconds, enough for a few meaningful moves, easy for a beat, then it bites, and it tightens as it goes. Each game remembers how often you have beaten it, across visits: every win raises that game's tier for the next time it comes up, a nudge rather than a wall, and two losses in a row lower it again. (`GK.arena.skill()` in the console shows the record; `GK.arena.forget()` clears it.)
   - **Breach the Wall** — brick breaker. A small wall shaped like an eye hangs close enough to touch and descends a row at a time, sooner each time; if it reaches the paddle it takes you. It is breached once six of its twenty-six bricks have fallen: the iris takes two hits, the pupil three, and the pupil fires glare that stuns the paddle. A second ball is served almost at once, the balls quicken with every second and every return, and the paddle shrinks as the wall thins. Three balls. Higher tiers: a faster ball, a quicker wall that starts lower, a narrower paddle, more glare, a brick or two more.
   - **Purge the Swarm** — shoot 'em up. Six watchers, then the Warden. They sweep in lines, dive at you and aim their shots, thicker and faster with every kill; for the first second they only approach. Twin cannon at half the quota; the Warden strafes faster as it is hurt, fires spreads at you and calls escorts. Three lives. Higher tiers: a bigger quota, a tougher Warden, a faster swarm.
   - **Outrun the Static** — dodge falling static and barred gates for seven seconds; seekers that hunt your position join at two (they commit to a column before they reach you), lashes that whip in from the edges after a blink of warning at four. One life, so nothing is allowed to coincide with a gate in a way that leaves no room: a lash comes from the side that leaves the gap open, and static and seekers keep out of a gap they would arrive with. The last two and a half seconds run negative and a quarter faster. Higher tiers: everything faster, narrower gates, a second or two longer.
   - **Recite the Sigil** — nothing to dodge and nowhere to run. The eye flashes a sequence of four runes, two to begin with, one longer and faster every round; recite it back, in order, before the timer drains. Three rounds. One wrong rune ends it. Higher tiers: quicker flashes, a tighter timer, a longer opening sequence.

   The music climbs with the game. On a last life (or the last seconds, or the last rounds) the frame pulses red and an alarm joins the beat.
4. Lose, and it mocks you (differently if you keep losing). Win, and it consults the session: the eye rolls up, the readout opens, and you watch what it reads (`READING src/auth/token.ts`, `SEARCHING "refresh"`) before the answer types itself out and is read aloud.

5. There is a wall plate in a corner, so faint it is nearly part of the background, held by four screws. Tap it and the screws loosen, a half-turn a tap, while the eye watches the corner and tells you to stop, more afraid each time. With the screws gone the plate swings open on its hinge and shows a switch, red, under a small label. Throw it and the switch turns green, and so does everything else: the iris, the glow, the console, the favicon. The gatekeeper is friendly now. It thanks you, in a voice that is no longer a demon's, over a drone that has drifted to a major chord, and while this holds it drops its trials and answers at once (the readout says `UNGATED`). It does not hold for long: the eye begins to flicker red, it asks you to hurry, and then the corruption takes it back. The page tears, the switch snaps off, the plate slams shut, and it fades out, to reappear in another corner, hidden again. If an answer is in progress when the time runs out, it is delivered first.

Leave it alone long enough and it mutters at you, and now and then glances at a corner.

## Tests

```sh
npm test                 # repo tools, both oracles (fake CLI / mock Messages API + MCP), the HTTP server, static files, every page script parses and loads in order
npx playwright install chromium && npm run test:e2e   # headless Chromium: standalone page, every game under an autopilot, the hidden panel from screws to corruption, bridge-served page, auto-bridge from a file:// page
CHROMIUM=/path/to/chrome npm run test:e2e               # with a Chromium you already have
```

## Structure

- `index.html` — the markup, and the list of stylesheets and scripts. The scripts are plain (not modules) so the page works from `file://` with no build step; each leaves one object behind for the next, and the order matters.
- `web/styles/` — `base.css` (the theme tokens; `body.friendly` redefines them green, `body.corrupting` tears the page), `eye.css`, `console.css`, `readout.css`, `arena.css`, `wake.css`, `setup.css` (the gear and its card), `switch.css` (the plate, screws, hinge and switch).
- `web/js/config.js` — `CONFIG`, the small helpers (`$`, `pick`, `rnd`, `clamp`, `wait`, `buzz`) and `Bus`, a tiny event bus.
- `web/js/audio.js` — `Audio_`: buses, convolver reverb, the drone with its heartbeat and metallic hits, a combat pulse with a kick, hats and a danger alarm, one-bit sfx. `setWarm()` glides the drone from bare fifths to a major chord with a pad; the panel's sounds (`screw`, `drop`, `creak`, `clack`, `chime`, `slam`, `corrupt`).
- `web/js/voice.js` — `Voice`: `speechSynthesis` pitched to the floor over a synthesized demon layer (detuned sub-bass, ring modulation, an asymmetric clipper, a throat formant that jumps on every word, static crackle, reverb); synced subtitles; `SpeechRecognition`. `setTone('kind')` switches to normal pitch over a soft hum.
- `web/js/eye.js` — `Eye`: almond lids, heartbeat-synced veins, a pre-rendered fibrous iris in two counter-rotating layers, pupil with saccades, moods (now also `fear` and `friendly`), bloom, grain, scan tears, chromatic ghosting. Two tints, red and green, each with its own iris render; `setTint(name, ms)` flickers between them before settling.
- `web/js/arena.js` — `Arena`: the 160×240 one-bit runtime (tiers, banners, a danger state that drives the music, 3×5 pixel font, particles, shake, haptics), the skill record, and `define()`, which the games call.
- `web/js/games/` — `bricks.js`, `shmup.js`, `dodge.js`, `sigil.js`: one trial each. Script order is the order of `Arena.GAMES`.
- `web/js/backend.js` — `Bridge` (`detect` at wake, `auto` and `connect` for the gear, the remembered endpoint) and `askClaude`, the streaming client with the in-page mock.
- `web/js/gate.js` — `Gate`: the flow, and its friendly variant that skips the trial.
- `web/js/setup.js` — `Setup`: the gear and the card.
- `web/js/switch.js` — `Switch`: the hidden panel, the friendly mode and the corruption that ends it.
- `web/js/input.js`, `web/js/main.js` — buttons and keys; the wake tap and the console handle.

  A console handle `GK` exposes the pieces: `GK.gate('…')`, `GK.eye.setMood('angry')`, `GK.arena.end(true)`, `GK.arena.run(GK.arena.byName('sigil'), 2)`, `GK.arena.current()`, `GK.arena.skill()`, `GK.arena.forget()`, `GK.bridge.auto()`, `GK.setup.show(true)`, `GK.switch.state()`, `GK.switch.hold(ms)` (how long friendly lasts), `GK.switch.corrupt()`. Each game's tier is kept in `localStorage` under `gatekeeper.skill`; a bridge connected through the gear under `gatekeeper.api`.
- `server.mjs` — HTTP server, auth, SSE, oracle selection.
- `server/oracle-claude-code.mjs` — spawns `claude -p … --output-format stream-json`, streams deltas and tool activity, resumes sessions.
- `server/oracle-api.mjs` — Anthropic SDK streaming tool-use loop; validates tool inputs, handles `refusal` / `pause_turn` / `max_tokens`, maps API errors to in-character messages. Starts over when a conversation outgrows its budget, or compacts with `COMPACT=1`.
- `server/repo-tools.mjs` — `repo_list`, `repo_read`, `repo_search` (ripgrep when available), `repo_git` (allowlisted). Paths are confined to the repository, secrets are withheld.
- `server/mcp.mjs` — loads `mcp.json`; stdio servers through the MCP SDK, remote ones through the API connector.
- `server/persona.mjs` — the voice the oracles answer in.

### Adding a game

Add a file under `web/js/games/` that calls `Arena.define(kit => def)` and list it in `index.html` after `arena.js`. `def` is an object with `name`, `brief` (a string, or a function of the tier), `help` (`[touch hint, keyboard hint]`), `init(level)` returning a state (`level` is that game's own tier, 0 to 9: how often the player has beaten it; make each step a nudge, and keep a trial to a handful of seconds with a gentle first beat), `step(state, dt)` returning `true` to win, `false` to lose or nothing to continue, and `draw(state)`. `kit` holds the one-bit helpers (`GW`, `GH`, `px`, `text`, `sprite`, `burst`, `flash`, `shake`, `note(state, 'BANNER')`), movement (`paddleInput`, `firing`) and discrete presses (`takeTaps()`: arrows, WASD, or a tap read by its quadrant). Optional state fields the arena reads: `heat` (0..1, the music climbs with it), `danger` (red pulsing frame, alarm in the beat), `look` (where the eye behind the arena stares; otherwise it follows `px` or `x`), `inverted` (draw the screen negative) and `why` (a line under TERMINATED).

### Adding lines

Append strings to `TAUNTS`, `LOSE`, `LOSE_AGAIN`, `WIN`, `WIN_STREAK`, `CONSULT`, `IDLE`, or their friendly counterparts `KIND_YES`, `KIND_CONSULT`, `KIND_IDLE`, in `web/js/gate.js`. What the eye says at the panel (`LOOSEN`, `OPENED`, `FRIENDLY`, `WANING`, `CORRUPT`, `RELOCATED`) is in `web/js/switch.js`. The oracles' voice lives in `server/persona.mjs`.

## Known limits

- Speech recognition is Chrome and Safari only and needs https or localhost. The text field always works.
- Browser TTS cannot be routed through Web Audio, so the distortion and reverb run on a synthesized layer underneath it; the engine itself is only asked for the lowest pitch it offers. Voice quality varies by OS; Windows and macOS have the deepest default voices. iOS may ignore the pitch setting, so the demon layer does most of the work there.
- The `api` oracle's request shape (streaming, adaptive thinking, `fallbacks: "default"`, eager tool-input streaming, the MCP connector) is verified against a mock of the Messages API in the tests; it has not been exercised against the live API from this repository.
