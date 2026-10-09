# PROTOTYPE: Durable-native child agents

Date: 2026-10-09. Branch: `spike/durable-child`. Packages: `@earendil-works/pi-durable` 1.1.0, `chord` 1.1.0, `pi-ai` 1.1.0.
Throwaway. Not deployed. Not merged to `main`.

## Question

Can a child agent run as a Durable-owned conversation in a Forgerie session, and does it

1. exist as an ordinary conversation that Forgerie can list, read, and link to,
2. take a steer from the user while it works,
3. stop on request without touching the parent (and survive the parent's Esc),
4. survive a daemon restart with no duplicate launch, question, or report,
5. ask the user a question that lands in the parent transcript without a parent model turn?

## Verdict

**Yes, on the server.** All five pass in two layers. The browser part (child view, question card, answer form)
was not built. The parts that work now and the work left are below.

| Check | Phase 1: raw Durable, scripted model | Phase 1: raw Durable, real model | Phase 2: Forgerie service + production Durable factory |
|---|---|---|---|
| C1 child is a listed, readable, linkable conversation | pass | pass | pass |
| C2 user steer reaches the running child | pass | pass (see finding 3) | pass |
| C3 stop ends the child only; parent Esc does not reach it | pass | pass | pass |
| C4a restart mid-tool: resumes, one child, one report | pass | pass | pass (see finding 2) |
| C4b restart mid-question: one question, later answer works | pass | pass | pass |
| C5 question in parent transcript, no parent turn | pass | pass | pass, live event and after reload |

Real model: `cliproxy/deepseek-v4.1-flash` through CLIProxyAPI, 110 s for the full run.
Phase 2 ran 3 times in a row with no failures. The full `src/server/sessions` suite still passes: 90 files, 1062 tests.

## Files

- `prototypes/durable-child-spike/spike.mjs`: phase 1. `./spike.mjs faux` or `./spike.mjs real`. Results go to `results-*.json`.
- `src/server/sessions/durableChildAgents.ts`: the child extension (`subagent` tool, anchor and reporter tasks, `ask_human`) and host operations (list, read, message, stop, answer).
- `src/server/sessions/durableAgentSession.ts`: installs the extension and keeps child-only tools off the parent. It emits a live message for question and answer entries. It also exposes the host operations.
- `src/server/sessions/durableSessionJournal.ts`: projects question and answer entries into the JSONL transcript as display-only `custom_message` entries. The projection does not duplicate them after a reopen.
- `src/server/sessions/piSessionService.ts`: `durableChildAgents` dependency and service methods `durableChildren`, `durableChildMessages`, `messageDurableChild`, `stopDurableChild`, and `answerDurableChildQuestion`.
- `src/server/sessions/durableChildAgents.spike.test.ts`: phase 2, one test per check.

Run phase 2: `nix shell nixpkgs#nodejs_24 -c npx vitest run src/server/sessions/durableChildAgents.spike.test.ts`.

## How it works

The `subagent` tool commits three things at once: a background anchor task of the parent conversation, a child
conversation owned by that anchor, and a reporter task. The reporter submits the message to the child. It waits for
the answer and posts it back to the parent as a follow-up input. Request IDs make every submission idempotent across
restarts. The child's question is one commit: a record in a parent document plus a non-model entry in the parent
transcript. The user's answer is one commit to that document. Neither starts a model run.

All children live in the parent session's own SQLite file. Forgerie already has one owner process (sessiond) for
that file.

## Findings

1. **Children have almost no tools yet.** That is the main cost of the next stage. Forgerie's SDK tools
   (`forgerie.sdk-tools`) are bound to the parent's extension runner, cwd, and journal projection. A child that selects
   them would fire the parent's extension hooks. The spike gives children only `ask_human` and a test tool. Two ways
   to fix this: Durable's own `read/write/edit/bash` (which needs a Harness `env`, and `DurableSessionJournal` passes
   none today), or a child-scoped SDK tool adapter.
2. **After a restart, children resume only when someone opens the parent session.** Sessiond does not open sessions
   at startup, so a child paused by a restart stays paused. Reading the transcript is not enough
   (C4a checks this). Production needs sessiond to reopen, at startup, every session whose storage has live tasks.
3. **The parent does not know that you steered a child.** In the real-model run, the user steered `builder` to stop. Its
   report said "stopped early per your steer". The parent model then sent `builder` a "correction" telling it to
   finish all steps, which overrode the user. A steer from the UI must also be recorded in the parent (for example a
   write entry), or the report must say that the user steered.
4. **Each report gives the parent a model turn.** That is how completion reaches the coordinator. It costs parent
   tokens even for "no reply needed". A workflow that waits for several children could gather reports as write entries
   and wake the parent once.
5. **Steers land at the next tool round.** A real model batched all `work` calls into one round, so a steer arrived
   only after the batch. The spike sets `executionMode: "sequential"` on the tool. One long tool call cannot be
   steered, only stopped.
6. **A child is not a Forgerie session.** It has no JSONL file, catalog entry, title, archive, pin, or worktree. The
   service methods reach it through the parent. A child view needs HTTP routes and a UI that use those methods.
7. **API friction, small.** `ConversationHandle.submit` types only inputs, so the question entry uses
   `tx.appendEntry`. `defineDoc` needs `type` aliases, and the repo lint rule wants `interface`. `ask_human` polls
   every 150 ms; `watchDoc` would be better.
8. **Lint is not clean** on the spike files (17 errors, mostly style rules). Spike code was not brought up to the
   repo standard.

## Not tested

- The browser: child view, question card, answer form, and the four Fold postures.
- Agent-file loading (model, tools, prompt per child), parallel fan-out with `waiting`/`allSettled`, worktree isolation.
- A real sessiond process restart (phase 2 disposes and recreates the service in one process; phase 1 closes and
  reopens the Harness). The earlier crash spike (`prototypes/pi-durable-spike`) covered `SIGKILL` for parent runs.
- Many children, long transcripts, compaction inside a child.

## Recommended next steps, in order

1. A child tool loadout (finding 1). Without it a child cannot do real work.
2. Sessiond reopens sessions with live Durable tasks at startup (finding 2).
3. Record user steers and stops in the parent (finding 3).
4. HTTP routes over the five service methods, then the child view and question card in `ui/` (finding 6).
5. Agent-file loading, then parallel fan-out. Stage 3 of the plan (worktrees) follows.
