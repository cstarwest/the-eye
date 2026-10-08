# Gatekeeper Eye

A full-screen, dark, red eye guards a Claude session. Ask it something; it taunts you in a deep, distorted voice, drops you into a one-bit pixel game under a dark synth drone and a driving beat, and only answers if you win. A trial is a handful of seconds, enough for a few meaningful moves, and each game remembers how often you have beaten it and tightens a little every time. When it answers, it is really reading your repository: through Claude Code or the Claude API, with MCP servers if you have them.

It is a desktop app (Electron) for macOS, Windows and Linux. If Claude Code is installed on the same machine, the app finds it and answers through it, with a supported current installation and no local server: no port, no browser, no web page. The window is plain HTML, CSS and scripts with no build step, no audio file and no image: the eye, the voice layer, the music and the games are all generated in it. The bridge to Claude runs in the app's main process and the window reaches it only through a small IPC surface.

**Before choosing a repository:** read [Security and privacy](SECURITY.md) for provider disclosure, tool restrictions, MCP authority and remaining risks.

Somewhere on the page there is a panel that was not meant to be opened.

## Quick start

Double-click the launcher for your system, at the top of this folder (it needs [Node.js](https://nodejs.org) 22.12 or newer):

| | |
|---|---|
| macOS | `Gatekeeper.command` |
| Windows | `Gatekeeper.cmd` |
| Linux | `gatekeeper.sh` (or run it from a terminal) |

It installs the dependencies the first time (and again whenever `package-lock.json` changes), then opens the app in its own window. The launcher's terminal window stays open beside it: close the app and the launcher exits; close the launcher's window (or press Ctrl+C in it) and the app quits.

From a terminal the same thing is:

```sh
npm run launch                         # or: node desktop/launch.mjs
npm run launch -- /path/to/repo        # point it at a repository (remembered)
npm start                              # the app alone, once npm install has run
```

The app reads this checkout unless you choose another repository.

### Closing it

Closing the window quits the app, on every platform (on macOS too, where apps usually linger in the Dock). Quitting requests cleanup of work the app started before it exits: the question in progress is cancelled, Claude Code and its tracked process group are signalled, the MCP servers the API oracle started are closed, and any git or ripgrep search still running is ended. App-tracked children use process groups (process trees on Windows); MCP SDK clients close separately. Cleanup is best effort, especially after abnormal termination or detached descendants; see [the limits](SECURITY.md#cancellation-and-process-cleanup).

Tap once to wake the eye. With Claude Code 2.1.248 or newer installed and signed in (`claude` has been run once in a terminal), the gear's dot is lit and the answers come from Claude Code reading your repository. Without it, a mock answers in character and the games still work.

To build an installable app (a `.dmg`, an NSIS installer or an AppImage, for the platform you build on):

```sh
npm run dist                   # output in dist/
```

The packaged app asks for a repository the first time it wakes (File → Choose Repository…, or ⌘O / Ctrl+O, or `gatekeeper /path/to/repo` from a terminal) and remembers it.

### The gear

A very faint gear sits in the top-left corner once the eye is awake. It opens the setup card: whether a real Claude is linked (the gear's dot is filled when it is, hollow when the mock answers), which oracle, which Claude Code (version and path), which model and repository, the session id, and what the bridge last said about itself. **FIND CLAUDE CODE** looks for it again, after you install it or sign in, without restarting; **CHOOSE REPOSITORY** opens the folder picker. The card opens by itself when a repository has to be chosen before Claude can answer.

### How it finds Claude Code

An app opened from the Dock, the Start menu or a desktop launcher does not inherit your terminal's PATH, so the app asks your login shell for its PATH (and any `ANTHROPIC_*` variables) once at startup, then looks for `claude`:

1. `CLAUDE_BIN` (or `"claudeBin"` in the settings file), when set
2. `claude` on PATH (on Windows `claude.exe`, then `claude.cmd`)
3. the usual install locations: `~/.local/bin` (the native installer), `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin`, `~/.bun/bin`, `~/.volta/bin`; on Windows `%USERPROFILE%\.local\bin\claude.exe` and `%APPDATA%\npm\claude.cmd`
4. the copy the Claude desktop app keeps for itself (`%APPDATA%\Claude\claude-code\<version>\…\claude.exe` on Windows, or under `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\` for the Microsoft Store build; `~/Library/Application Support/Claude/claude-code/…` on macOS), newest version first

Repository-local, relative and empty PATH candidates are excluded. Discovery probes run with isolated working/config directories and without credentials. The first candidate that answers `--version` is selected; answering additionally requires a current CLI supporting restricted configuration and tool flags. On Windows, an npm `claude.cmd` shim is followed to the `claude.exe` (or `cli.js`) it starts, so the question is never passed through a shell.

## The oracles

The bridge answers through one of three oracles. It picks one automatically, or set `ORACLE=` (or `"oracle"` in the settings file):

| Oracle | What answers | Needs |
|---|---|---|
| `claude-code` | `claude -p` from an isolated working directory, with only the app’s restricted repository MCP tools, resumed between questions | [Claude Code](https://claude.ai/code) installed and logged in |
| `api` | The Claude API (`claude-opus-5-5`, streaming, adaptive thinking, server-side refusal fallback) with built-in read-only repository tools and your MCP servers | `ANTHROPIC_API_KEY`, or `ant auth login` |
| `mock` | Canned answers, no model | nothing |

Auto-pick: `claude-code` when Claude Code is found; else `api` when `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_PROFILE` is set; else `mock`.

```sh
ORACLE=api ANTHROPIC_API_KEY=sk-ant-... npm start -- /path/to/repo
```

### Settings

The app keeps a settings file in its user-data folder (File → Open Settings File): `~/Library/Application Support/Gatekeeper/settings.json` on macOS, `%APPDATA%\Gatekeeper\settings.json` on Windows, `~/.config/Gatekeeper/settings.json` on Linux. The repository you choose is saved there; everything else is optional. An environment variable of the same meaning wins for that launch.

| Setting | Variable | Default | Meaning |
|---|---|---|---|
| `repo` | `REPO` | this checkout (`npm start`); asked for (packaged app) | the repository the gatekeeper reads |
| `oracle` | `ORACLE` | auto | `claude-code`, `api` or `mock` |
| `model` | `MODEL` | Claude Code's default / `claude-opus-5-5` | model for the chosen oracle |
| `effort` | `EFFORT` | `medium` | `api` only: `low`, `medium`, `high`, `xhigh`, `max` |
| `maxTurns` | `MAX_TURNS` | `12` | tool-use turns per question |
| `mcpConfig` | `MCP_CONFIG` | `mcp.json` in the user-data folder, if present | MCP servers (see below) |
| `compact` | `COMPACT=1` | off | `api` only: server-side compaction of long conversations instead of starting over |
| `claudeBin` | `CLAUDE_BIN` | found (see above) | path to the Claude Code CLI |
| `claudeTools` | `CLAUDE_TOOLS` | fixed app-owned repository tools | Custom overrides are refused by the hardened Claude Code oracle |
| `permissionMode` | `CLAUDE_PERMISSION_MODE` | `dontAsk` | Permission overrides are refused; only exact repository MCP tools are pre-approved |
| `timeoutMs` | `TIMEOUT_MS` | `300000` | `claude-code` only: per-question limit |

`GATEKEEPER_SHELL_ENV=0` skips reading the login shell's environment; `GATEKEEPER_USER_DATA` moves the user-data folder (the tests use both).

### MCP

Put an `mcp.json` in the app's user-data folder (or point `mcpConfig` / `MCP_CONFIG` at one) in the format Claude Desktop and Claude Code use; `mcp.example.json` shows it.

- `claude-code`: only the app-owned repository MCP is supported. External `mcpConfig`, repository `.mcp.json` and custom tool/permission overrides are refused or excluded. Normal subscription authentication is retained. Update Claude Code if the app reports missing security capabilities.
- `api`: each server requires an exact `allowedTools` array before it is connected. Only those names are exposed; new tools remain disabled. Granting a tool allows unattended calls and can permit writes or disclosure. Stdio servers run with your OS privileges; remote servers connect through the API. Review [MCP authority](SECURITY.md#external-mcp-authority) first.

### How the window talks to the bridge

The window is sandboxed: no Node, no network (its content policy sets `connect-src 'none'`), no navigation, no new windows, no permissions. `desktop/preload.cjs` gives it one object, `window.gatekeeper`, with `status()`, `redetect()`, `chooseRepo()`, `ask(id, question, session, onEvent)` and `cancel(id)`. While a question is answered the main process sends events back: `tool` / `status` (what the oracle is doing, shown under the eye) and `delta` (text, typed into the readout and spoken sentence by sentence as it arrives); `ask` then resolves `{ ok, answer }` or `{ ok: false, error }`.

## Controls

| | |
|---|---|
| Type and press Enter, or ASK | ask the gatekeeper |
| `/` | focus the input |
| Esc, or tap the readout | dismiss an answer (Esc also closes the setup card) |
| the faint gear, top-left | setup: link status, find Claude Code, choose a repository |
| ⌘O / Ctrl+O | choose the repository |
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
npm test                 # process trees stopped (grandchildren too), repo tools, both oracles (fake CLI / mock Messages API + MCP), finding Claude Code (PATH, install locations, Windows shims, login shell), the bridge (oracle choice, repository, cancel), the window's lockdown, every page script parses and loads in order
npm run test:e2e         # the desktop app under Playwright: no Claude Code (mock, every game under an autopilot, the hidden panel from screws to corruption), a stand-in Claude Code on PATH found, linked and answering, the window closed mid-answer (claude and its child stopped), and the launcher (it exits with the app, and the app with it)
xvfb-run -a npm run test:e2e   # the same on a Linux machine without a display
```

## Structure

- `index.html` — the markup, the content policy, and the list of stylesheets and scripts. The scripts are plain (not modules), loaded from disk with no build step; each leaves one object behind for the next, and the order matters.
- `web/styles/` — `base.css` (the theme tokens; `body.friendly` redefines them green, `body.corrupting` tears the page), `eye.css`, `console.css`, `readout.css`, `arena.css`, `wake.css`, `setup.css` (the gear and its card), `switch.css` (the plate, screws, hinge and switch).
- `web/js/config.js` — `CONFIG`, the small helpers (`$`, `pick`, `rnd`, `clamp`, `wait`, `buzz`) and `Bus`, a tiny event bus.
- `web/js/audio.js` — `Audio_`: buses, convolver reverb, the drone with its heartbeat and metallic hits, a combat pulse with a kick, hats and a danger alarm, one-bit sfx. `setWarm()` glides the drone from bare fifths to a major chord with a pad; the panel's sounds (`screw`, `drop`, `creak`, `clack`, `chime`, `slam`, `corrupt`).
- `web/js/voice.js` — `Voice`: `speechSynthesis` pitched to the floor over a synthesized demon layer (detuned sub-bass, ring modulation, an asymmetric clipper, a throat formant that jumps on every word, static crackle, reverb); synced subtitles. `setTone('kind')` switches to normal pitch over a soft hum.
- `web/js/eye.js` — `Eye`: almond lids, heartbeat-synced veins, a pre-rendered fibrous iris in two counter-rotating layers, pupil with saccades, moods (now also `fear` and `friendly`), bloom, grain, scan tears, chromatic ghosting. Two tints, red and green, each with its own iris render; `setTint(name, ms)` flickers between them before settling.
- `web/js/arena.js` — `Arena`: the 160×240 one-bit runtime (tiers, banners, a danger state that drives the music, 3×5 pixel font, particles, shake, haptics), the skill record, and `define()`, which the games call.
- `web/js/games/` — `bricks.js`, `shmup.js`, `dodge.js`, `sigil.js`: one trial each. Script order is the order of `Arena.GAMES`.
- `web/js/backend.js` — `Bridge` (`detect` at wake, `auto` and `chooseRepo` for the gear) and `askClaude`, the streaming client over `window.gatekeeper`.
- `web/js/gate.js` — `Gate`: the flow, and its friendly variant that skips the trial.
- `web/js/setup.js` — `Setup`: the gear and the card.
- `web/js/switch.js` — `Switch`: the hidden panel, the friendly mode and the corruption that ends it.
- `web/js/input.js`, `web/js/main.js` — buttons and keys; the wake tap and the console handle.

  A console handle `GK` exposes the pieces: `GK.gate('…')`, `GK.eye.setMood('angry')`, `GK.arena.end(true)`, `GK.arena.run(GK.arena.byName('sigil'), 2)`, `GK.arena.current()`, `GK.arena.skill()`, `GK.arena.forget()`, `GK.bridge.auto()`, `GK.bridge.chooseRepo()`, `GK.setup.show(true)`, `GK.switch.state()`, `GK.switch.hold(ms)` (how long friendly lasts), `GK.switch.corrupt()`. Each game's tier is kept in `localStorage` under `gatekeeper.skill`.
- `Gatekeeper.command`, `Gatekeeper.cmd`, `gatekeeper.sh` — the double-click launchers; each finds Node and runs `desktop/launch.mjs`.
- `desktop/launch.mjs` — installs dependencies when needed, starts the app, and ties the two together: either one closing closes the other.
- `desktop/main.mjs` — the Electron main process: the window and its lockdown, the menu, the folder picker, IPC to the bridge, one instance at a time (a second launch with a folder hands it to the first), and the quit that attempts tracked-process cleanup.
- `desktop/processes.mjs` — every process the app starts goes through here, in its own process group, so quitting can stop each one with everything under it.
- `desktop/preload.cjs` — `window.gatekeeper`, the window's only way out.
- `desktop/bridge.mjs` — picks the oracle, keeps the repository and the settings file, answers and cancels questions. Plain Node, so the tests drive it without Electron.
- `desktop/find-claude.mjs` — finds Claude Code: the login shell's PATH, the install locations, Windows shims.
- `desktop/oracle-claude-code.mjs` — spawns `claude -p … --output-format stream-json`, streams deltas and tool activity, resumes sessions.
- `desktop/oracle-api.mjs` — Anthropic SDK streaming tool-use loop; validates tool inputs, handles `refusal` / `pause_turn` / `max_tokens`, maps API errors to in-character messages. Starts over when a conversation outgrows its budget, or compacts with `COMPACT=1`.
- `desktop/repo-tools.mjs` — `repo_list`, `repo_read`, `repo_search` (ripgrep when available), `repo_git` (fixed metadata operations). Paths and common secret filenames are filtered. Gitfiles/linked worktrees and redirected Git metadata are unsupported; see SECURITY.md for limits.
- `desktop/mcp.mjs` — loads `mcp.json`; stdio servers through the MCP SDK, remote ones through the API connector.
- `desktop/persona.mjs` — the voice the oracles answer in.

### Adding a game

Add a file under `web/js/games/` that calls `Arena.define(kit => def)` and list it in `index.html` after `arena.js`. `def` is an object with `name`, `brief` (a string, or a function of the tier), `help` (`[touch hint, keyboard hint]`), `init(level)` returning a state (`level` is that game's own tier, 0 to 9: how often the player has beaten it; make each step a nudge, and keep a trial to a handful of seconds with a gentle first beat), `step(state, dt)` returning `true` to win, `false` to lose or nothing to continue, and `draw(state)`. `kit` holds the one-bit helpers (`GW`, `GH`, `px`, `text`, `sprite`, `burst`, `flash`, `shake`, `note(state, 'BANNER')`), movement (`paddleInput`, `firing`) and discrete presses (`takeTaps()`: arrows, WASD, or a tap read by its quadrant). Optional state fields the arena reads: `heat` (0..1, the music climbs with it), `danger` (red pulsing frame, alarm in the beat), `look` (where the eye behind the arena stares; otherwise it follows `px` or `x`), `inverted` (draw the screen negative) and `why` (a line under TERMINATED).

### Adding lines

Append strings to `TAUNTS`, `LOSE`, `LOSE_AGAIN`, `WIN`, `WIN_STREAK`, `CONSULT`, `IDLE`, or their friendly counterparts `KIND_YES`, `KIND_CONSULT`, `KIND_IDLE`, in `web/js/gate.js`. What the eye says at the panel (`LOOSEN`, `OPENED`, `FRIENDLY`, `WANING`, `CORRUPT`, `RELOCATED`) is in `web/js/switch.js`. The oracles' voice lives in `desktop/persona.mjs`.

## Known limits

- There is no voice input in the desktop app: Electron has no speech-recognition service behind the browser API (Chrome's is Google's), so MIC is hidden and questions are typed.
- The system's text-to-speech cannot be routed through Web Audio, so the distortion and reverb run on a synthesized layer underneath it; the engine itself is only asked for the lowest pitch it offers. Voice quality varies by OS; Windows and macOS have the deepest default voices.
- The `api` oracle's request shape (streaming, adaptive thinking, `fallbacks: "default"`, eager tool-input streaming, the MCP connector) is verified against a mock of the Messages API in the tests; it has not been exercised against the live API from this repository.
