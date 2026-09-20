# Prototypes

Throwaway visual prototypes. **Nothing here ships and nothing here is wired
into the app.**

This directory is deliberately outside every tool's scope:

| Tool | Scope | Sees `prototypes/`? |
|---|---|---|
| `tsc` | `tsconfig.json` `include` | no |
| `eslint` | `eslint.config.js` `files` | no |
| `knip` | `knip.json` `project` | no |
| `vite` | `src/client` | no |

So `npm run verify` is unaffected by anything in here.

## Running one

Prototypes are plain ES modules with no build step. They need an HTTP server
(ES module imports do not work over `file://`):

```bash
cd prototypes
python3 -m http.server 8600
# then open http://127.0.0.1:8600/session-board/
```

## Current prototypes

- [`quota-shelf/`](./quota-shelf/) — the shipped CLIProxyAPI quota shelf, re-cut
  against two complaints: it never states how much fuel is left, and it draws
  Gemini's unmetered pool as a full tank. One fixture from the live `/quota`
  payload (plus a proxy cooldown and a spent account), one
  `plan(width, height)` in `plan.js`, four renderings executed across the same
  seven-rung ladder from 236 px to a 900×232 strip: A ledger (today's shape,
  made honest), B fuel (one binding number per account, which also surfaces the
  hidden five-hour Claude window), C runway (percentages as time, with a reset
  mark per lane), D trend (24 h of history, and a tick per 429 where there is no
  level to draw). Round 2 answers the defect round 1 shipped with: it was
  taller than the shelf it replaced. `round2.html` replicates the live shelf
  from its own CSS as a ruler (560 px for seven accounts at 360 px wide) and
  measures three shorter answers beside it: E trimmed (316 px, keeps every
  lane), F one line per account (188 px, lanes become state dots), G routed
  only (184 px, one row per provider plus a spare count).
  Round 3 is the answer: one design in two states, neither spending a line on
  an address. Collapsed is one row per account (184 px) carrying the lane that
  binds plus a dot per other lane; expanded is provider-led and lossless
  (301 px), every window of every account as a chip with its own number and
  return time, so the five-hour window and a spare that comes back tomorrow
  are both readable. A spent lane trades its zero for `back 4d`, at every
  width. `node render.mjs [outDir]` captures each ladder over CDP,
  `PAGES=round3` captures one; pages also work over `file://`. Round 4 quiets
  it: health carries no colour at all (grey rail, plain text) so amber and red
  are the only saturated marks, provider names shrink to two letters, the
  routed account becomes a rail on the row edge instead of a word, countdowns
  state one unit (`38h`, never `1d 14h`), and the long Claude/Codex window is
  named `week` so its label cannot be confused with its countdown. Collapsed
  176 px, expanded 186 px.

- [`accounts-board/`](./accounts-board/) — fullscreen second-screen monitor
  for the LLM accounts (quota windows, resets, auth health). Two rounds on
  one live fixture. Round 1 (labeled numbers — rejected as dashboard slop):
  A meter wall, B departure board, C horizon, D triage. Round 2 (state as
  form, text as engraving): E tanks (levels), F trails (burn seismograph),
  G dials (chronographs). Round 3 (what the user cares about mid-work):
  H relay runway — pace turns percentages into wall-clock time, accounts
  chain into a relay, one verdict headline. Five states via
  `?scenario=calm|crunch|idle|dry|stale`; `&speed=60` time-lapses the
  eroding active leg. Motion is informational only: leg erosion, verdict
  cross-fade, boundary pulse in the final 10 minutes (all
  reduced-motion-guarded). `render.sh` captures 1920x1080 + 932x553; pages
  also work over `file://`.

- [`handoff-record/`](./handoff-record/) — what a `/handoff` turn leaves
  behind. Today it is a skill card, a bare focus bubble, and `✓ 2 steps`.
  Four treatments over real session data: A receipt on the rail, B a
  handoff record in the answer's place, C the record carrying the
  destination's live board state, D one centred boundary rule. Round 2
  (`stateless.html`) drops every state readout because the inbox owns state:
  E a door line, F the door in the bubble's tail, G a stateless boundary.
  **Verdict: F, shipped.** One `/name args` bubble for every skill
  invocation; the door only on turns that created a session. `render.sh [stateless]`
  captures each at three Fold postures over CDP emulation.

- [`interim-voice/`](./interim-voice/) — three voices for one turn: what the
  user said, what the agent finally answered, and the interim narration in
  between. One conversation, four treatments switchable with the arrow keys
  or a `#variant` fragment: `today` (baseline), `registers` (interim drops to
  the small muted voice), `rail` (narration and step folds share one hairline
  rail, the answer stands outside), `promote` (quiet work log, the answer
  alone carries an accent hairline and the turn meta). `render.sh` captures
  every variant at two postures over CDP emulation, because raw
  `--window-size` clamps below 500px width. **Verdict: `rail` won** and is
  implemented in the transcript; see the folder README.

- [`voice-content/`](./voice-content/) — **the only prototype here with its own
  flake and a server.** Real speech in both directions: CUDA Kokoro for the
  voice, `whisper.cpp` for hearing, Smart Turn for turn-taking. The question is
  whether the voice can use the chat stream as its source without reading the
  chat aloud, so the narrator merges, drops, and points at the screen instead of
  dictating it. Live for phone testing at
  <https://zao.hummingbird-lake.ts.net:8790> (tailnet only; see the folder
  README for how to take it down). Three treatments via `?variant=`: `follow` (whole transcript,
  voice marks the block), `deck` (one evidence card, no log), `ambient` (dark
  until the voice hands something over). Run with `nix run path:.` from that
  directory, then talk to it. `loop-check.mjs` closes the spoken loop with no
  human present.

- [`pen-context/`](./pen-context/) — pen input on a tablet. Four variants:
  mark the transcript to build a prompt, margin review on a diff, send a
  drawing, and a pen capability probe. Serve with
  `node serve.mjs . 8600 0.0.0.0` and open it on the tablet at
  <https://zao.hummingbird-lake.ts.net:8444/pen-context/> (https is needed for
  the voice experiment).
- [`session-board/`](./session-board/) — the inbox redesign. Sessions become
  the root list, grouped by **what they need from you** instead of **where they
  live**. Open `session-board/index.html` through the prototype server.
- [`table-reflow/`](./table-reflow/) — four ways to read a two-column table in
  the transcript, against the shipped stacking: A pairs (name over meaning,
  heading said once), B prose (each record one sentence, no block), C rows
  (a real wrapping table that folds to A under 26rem). `capture.mjs` shoots
  the postures, `measure.mjs` prints the block height each one costs.
