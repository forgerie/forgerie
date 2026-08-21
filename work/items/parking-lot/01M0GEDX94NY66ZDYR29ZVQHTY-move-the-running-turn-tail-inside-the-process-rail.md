---
id: 01M0GEDX94NY66ZDYR29ZVQHTY
slug: move-the-running-turn-tail-inside-the-process-rail
title: Move the running-turn tail inside the process rail
origin: parked
status: To Do
priority: medium
labels:
  - chat
  - ui
created: 2026-08-20
source: se-work
---

# Move the running-turn tail inside the process rail

## Why it matters

The liveness line, queued prompts, and open asks render below the rail while every other part of the space between question and answer sits inside it. On the posture captures the liveness dot floats disconnected under the rail's foot. Placing the tail inside the rail completes the three-voice reading: everything the turn is still doing shares one object.

## Acceptance Criteria

- [ ] renderRunningTurnTail output renders inside .turn-rail for the live turn
- [ ] Reserved-space and scroll-anchor tests still pass (turn-body min-height semantics unchanged)
- [ ] Posture captures show the liveness line on the rail

## Related

- `src/client/src/components/ChatView.ts`
- `prototypes/interim-voice/README.md`
