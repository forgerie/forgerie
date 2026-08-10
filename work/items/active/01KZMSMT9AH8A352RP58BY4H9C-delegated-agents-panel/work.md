---
id: 01KZMSMT9AH8A352RP58BY4H9C
slug: delegated-agents-panel
title: Delegated agents panel
status: active
created: 2026-08-09
source: se-plan
artifacts:
  - plan.md
---

# Delegated agents panel

Give a session's `pi-subagents` delegated runs a home in the session pane,
beside Files, Git, Terminal, and Processes. Delegated agents stay owned by the
parent session that spawned them; the inbox keeps triaging journeys and says
nothing about agents.

Planned directly from a design session that traced why 36 sessions titled
"Investigate bug causal chain before implementing a tested fix" appeared as
independent inbox rows, and wireframed the alternative. No upstream
requirements doc exists.

## Progress

### 2026-08-09 — U1 probe passed, derivation landed

The U1 gate asked whether live per-agent detail can reach the browser at all.
It can, and the proof is in code rather than in a lucky observation:

- `node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js` emits
  `tool_execution_update` from the `onUpdate` callback it hands to every tool,
  so any tool that reports progress produces the event.
- `src/server/sessions/piSessionService.ts` maps `tool_execution_update` to
  `tool.update` and forwards `details` untouched.
- `src/client/src/api/parsers.ts` keeps `details` on both `tool.update` and
  `tool.end`, and `chatTranscript.ts` lands it on the `ToolExecutionPart`.

So R4 is reachable and U2–U4 are worth building. `pi-subagents` does call
`onUpdate`, so its `Details.progress[]` is what arrives.

One thing the probe did not settle: a captured real payload is still wanted as
a regression fixture against upstream shape drift. The current fixtures are
hand-built from the recorded 9 Aug `hiper` runs.

`deriveDelegatedRuns` landed with 15 tests covering completed runs, live
progress, pre-flight arguments, parallel/chain expansion, unreadable details,
and async/detached provenance.
