---
id: 01M0EWSYS5E88JMDP68CHNTWA1
slug: resync-session-list-when-archive-returns-session-not-found
title: Resync session list when archive returns Session not found
origin: parked
status: To Do
priority: medium
labels:
  - ux
  - sessions
  - resilience
created: 2026-08-20
source: se-debug
---

# Resync session list when archive returns Session not found

## Why it matters

A stale browser tab showed already-archived duplicate rows as current; archiving one returned 404 "Session not found" and the row stayed, reading as "I can't archive this". The 404 proves the client list has diverged from the server, so the correct recovery is an automatic list refetch (dropping the ghost row) plus a toast explaining the row was already gone — not a bare error.

## Acceptance Criteria

- [ ] Archive/archive-many failure with 'Session not found' triggers a session-list refetch for that workspace
- [ ] The ghost row disappears without a manual page reload
- [ ] Toast copy explains the session was already archived/removed elsewhere
- [ ] Covered by a sessionController test

## Related

- `src/client/src/controllers/sessionController.ts`
- `src/client/src/controllers/sessionController.archiveCleanup.test.ts`
