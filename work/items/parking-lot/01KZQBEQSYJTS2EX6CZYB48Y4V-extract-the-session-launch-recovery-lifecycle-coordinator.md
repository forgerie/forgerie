---
id: 01KZQBEQSYJTS2EX6CZYB48Y4V
slug: extract-the-session-launch-recovery-lifecycle-coordinator
title: Extract the session-launch recovery lifecycle coordinator
origin: parked
status: To Do
priority: medium
labels:
  - architecture
  - sessions
  - recovery
created: 2026-08-11
source: se-code-review
context:
  cwd: .worktrees/feat/global-new-session-composer
  branch: feat/global-new-session-composer
  repo: forgerie
---

# Extract the session-launch recovery lifecycle coordinator

## Why it matters

Initial-prompt recovery now spans queue delivery, transcript reconciliation, selection, retry, archive/delete cleanup, and activity projection inside SessionController. A focused coordinator can reduce the risk that future lifecycle changes leave stale recovery records or projections.

## Acceptance Criteria

- [ ] Recovery record storage and stage transitions live behind a focused module contract.
- [ ] SessionController delegates recovery projection and lifecycle cleanup through that contract.
- [ ] Existing session-launch recovery, archive/delete, and queued-send tests remain green.

## Related

- `src/client/src/controllers/sessionController.ts`
- `work/items/active/01KZQ6V8N2M4J7H9T3C5R1F0XA-global-new-session-composer/plan.md`
