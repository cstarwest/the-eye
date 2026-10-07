# Gatekeeper Eye

A full-screen, dark, red eye guards a Claude session. Ask it something by typing or speaking; it taunts you in a deep, distorted voice, drops you into a one-bit pixel game under a dark synth drone and a driving beat, and only answers if you win. Every win makes the next trial harder. When it answers, it is really reading your repository: through Claude Code or the Claude API, with MCP servers if you have them.

The page is one HTML file with no build step, no dependency, no audio file and no image: the eye, the voice layer, the music and the games are all generated in the browser. The bridge that connects it to Claude is a small Node server.

## Quick start

```sh
npm install
node server.mjs            # serves the page and picks an oracle (see below)
# open http://localhost:3000 and tap once
```

Without a bridge, the page still works on its own: open `index.html` directly and a mock oracle answers in character.

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

`GET /health` → `{ gatekeeper: true, oracle, model, repo }`. The page probes this on its own origin when it wakes, so a page served by the bridge is live automatically. A page served from elsewhere can point at a bridge with `?api=http://localhost:3000` (and `&key=…` when a secret is set).

`POST /ask` with `{ question, session }`. With `Accept: text/event-stream` the answer streams as server-sent events: `tool` / `status` (what the oracle is doing, shown under the eye), `delta` (text, typed into the readout and spoken sentence by sentence as it arrives), then `done { answer }` or `error { message }`. Without it, plain JSON `{ answer }`.

For remote or mobile use, put the bridge behind a tunnel (ngrok, Cloudflare Tunnel) and set `GATEKEEPER_SECRET`.

## Controls

| | |
|---|---|
| Type and press Enter, or ASK | ask the gatekeeper |
| MIC | speak the question (Chrome and Safari, https or localhost) |
| `/` | focus the input |
| Esc, or tap the readout | dismiss an answer |
| Drag, or ← → / A D | move in the games |
| Hold, or Space | fire (Purge the Swarm) |
| Tap a rune, or ↑ → ↓ ← / W D S A | recite (Recite the Sigil) |

## What happens

1. The eye wakes: lids open, the iris ignites, a drone swells.
2. Your question makes it angry. It taunts you, the screen tears, the drone intensifies.
3. One of four games starts at random (never the same one twice in a row), and each one tightens as it goes. Every trial you have already won raises the tier of the next: more to kill, longer to survive, a faster wall, more rounds.
   - **Breach the Wall** — brick breaker. The wall is shaped like an eye and descends a row at a time, sooner each time; if it reaches the paddle it takes you. The ball quickens with every second and every return, the paddle shrinks as the wall thins, a second ball is served at forty percent cleared, and the pupil, three hits deep, fires glare that stuns the paddle. Three balls.
   - **Purge the Swarm** — shoot 'em up. Watchers sweep in lines, dive at you and aim their shots. Twin cannon at half the quota; at the quota, the Warden: a great eye that strafes faster as it is hurt, fires spreads at you and calls escorts. Three lives.
   - **Outrun the Static** — dodge falling static and barred gates, then seekers that hunt your position, then lashes that whip in from the edges after a blink of warning. The last six seconds run negative and a quarter faster. One life.
   - **Recite the Sigil** — nothing to dodge and nowhere to run. The eye flashes a sequence of four runes, one longer and faster every round; recite it back, in order, before the timer drains. Six rounds. One wrong rune ends it.

   The music climbs with the game. On a last life (or the last seconds, or the last rounds) the frame pulses red and an alarm joins the beat.
4. Lose, and it mocks you (differently if you keep losing). Win, and it consults the session: the eye rolls up, the readout opens, and you watch what it reads (`READING src/auth/token.ts`, `SEARCHING "refresh"`) before the answer types itself out and is read aloud.

Leave it alone long enough and it mutters at you.

## Tests

```sh
npm test                 # repo tools, both oracles (fake CLI / mock Messages API + MCP), the HTTP and SSE server
npx playwright install chromium && npm run test:e2e   # headless Chromium: standalone page, every game under an autopilot, bridge-served page
CHROMIUM=/path/to/chrome npm run test:e2e               # with a Chromium you already have
```

## Structure

- `index.html` — the page. Sections: CONFIG · AUDIO (buses, convolver reverb, the drone with its heartbeat and metallic hits, a combat pulse with a kick, hats and a danger alarm, one-bit sfx) · VOICE (`speechSynthesis` pitched to the floor over a synthesized demon layer: detuned sub-bass, ring modulation, an asymmetric clipper, a throat formant that jumps on every word, static crackle, reverb; synced subtitles; `SpeechRecognition`) · EYE (almond lids, heartbeat-synced veins, a pre-rendered fibrous iris in two counter-rotating layers, pupil with saccades, moods, bloom, grain, scan tears, chromatic ghosting) · ARENA (160×240 one-bit games with tiers, banners and a danger state that drives the music, 3×5 pixel font, particles, shake, haptics) · BACKEND (`askClaude`, the streaming client and the mock) · GATE (the flow) · INPUT · WAKE. A console handle `GK` exposes the pieces (`GK.gate('…')`, `GK.eye.setMood('angry')`, `GK.arena.end(true)`, `GK.arena.run(GK.arena.byName('sigil'), 2)`, `GK.arena.current()`).
- `server.mjs` — HTTP server, auth, SSE, oracle selection.
- `server/oracle-claude-code.mjs` — spawns `claude -p … --output-format stream-json`, streams deltas and tool activity, resumes sessions.
- `server/oracle-api.mjs` — Anthropic SDK streaming tool-use loop; validates tool inputs, handles `refusal` / `pause_turn` / `max_tokens`, maps API errors to in-character messages. Starts over when a conversation outgrows its budget, or compacts with `COMPACT=1`.
- `server/repo-tools.mjs` — `repo_list`, `repo_read`, `repo_search` (ripgrep when available), `repo_git` (allowlisted). Paths are confined to the repository, secrets are withheld.
- `server/mcp.mjs` — loads `mcp.json`; stdio servers through the MCP SDK, remote ones through the API connector.
- `server/persona.mjs` — the voice the oracles answer in.

### Adding a game

Write an object with `name`, `brief` (a string, or a function of the tier), `help` (`[touch hint, keyboard hint]`), `init(level)` returning a state (`level` is how many trials the player has won; make it bite), `step(state, dt)` returning `true` to win, `false` to lose or nothing to continue, and `draw(state)` using the one-bit helpers (`px`, `text`, `sprite`, `burst`, `flash`, `shake`, `note(state, 'BANNER')`), then add it to `GAMES`. Movement comes from `paddleInput` and `firing`; discrete presses (arrows, WASD, or a tap read by its quadrant) from `takeTaps()`. Optional state fields the arena reads: `heat` (0..1, the music climbs with it), `danger` (red pulsing frame, alarm in the beat), `look` (where the eye behind the arena stares; otherwise it follows `px` or `x`), `inverted` (draw the screen negative) and `why` (a line under TERMINATED).

### Adding lines

Append strings to `TAUNTS`, `LOSE`, `LOSE_AGAIN`, `WIN`, `WIN_STREAK`, `CONSULT` or `IDLE` in the GATE section. The oracles' voice lives in `server/persona.mjs`.

## Known limits

- Speech recognition is Chrome and Safari only and needs https or localhost. The text field always works.
- Browser TTS cannot be routed through Web Audio, so the distortion and reverb run on a synthesized layer underneath it; the engine itself is only asked for the lowest pitch it offers. Voice quality varies by OS; Windows and macOS have the deepest default voices. iOS may ignore the pitch setting, so the demon layer does most of the work there.
- The `api` oracle's request shape (streaming, adaptive thinking, `fallbacks: "default"`, eager tool-input streaming, the MCP connector) is verified against a mock of the Messages API in the tests; it has not been exercised against the live API from this repository.
