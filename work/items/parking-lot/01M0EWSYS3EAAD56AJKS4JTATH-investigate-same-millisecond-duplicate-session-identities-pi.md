---
id: 01M0EWSYS3EAAD56AJKS4JTATH
slug: investigate-same-millisecond-duplicate-session-identities-pi
title: Investigate same-millisecond duplicate session identities (.pi workspace)
origin: parked
status: To Do
priority: medium
labels:
  - sessions
  - data-integrity
created: 2026-08-20
source: se-debug
---

# Investigate same-millisecond duplicate session identities (.pi workspace)

## Why it matters

On 2026-08-19T22:20:34Z three copies of one 199-message session were persisted with three fresh UUIDv7 ids (…a3b8/…a3c3/…a3cb, filename timestamps 34.104/.115/.123), plus a fourth (…177d) at 22:21:03 — with no corresponding HTTP request in web/sessiond logs, so the fanout came from the session runtime (identity replacement / re-persist), not a user action. The duplicates polluted the session list twice and cost the user two manual cleanup rounds. Separately, 01a01ada's file was re-written at its original path ~10 min after being archived (a runtime still held it open), leaving disk cruft the archive store papers over.

## Acceptance Criteria

- [ ] Root cause identified for multi-save-with-new-id fanout (pi SessionManager re-persist, crash recovery, or concurrent open)
- [ ] A guard or reconcile rule prevents identical-content twin sessions from accumulating in the live list
- [ ] Post-archive rewrites at the original path are reconciled (documented archive-reconcile behavior) rather than left as orphan files

## Related

- `src/server/sessions/piSessionService.ts`
- `src/server/sessions/piSessionService.crossWorkspace.test.ts`
