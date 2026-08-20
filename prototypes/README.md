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

- [`pen-context/`](./pen-context/) — pen input on a tablet. Four variants:
  mark the transcript to build a prompt, margin review on a diff, send a
  drawing, and a pen capability probe. Serve with
  `node serve.mjs . 8600 0.0.0.0` and open it on the tablet at
  <https://zao.hummingbird-lake.ts.net:8444/pen-context/> (https is needed for
  the voice experiment).
- [`session-board/`](./session-board/) — the inbox redesign. Sessions become
  the root list, grouped by **what they need from you** instead of **where they
  live**. Open `session-board/index.html` through the prototype server.
