---
id: 01KZGZ9KSNRW8JRY8RSWHB8P8H
slug: establish-a-machine-global-session-domain-boundary
title: Establish a machine-global session domain boundary
origin: parked
status: To Do
priority: high
labels:
  - architecture
  - sessions
  - realtime
  - state-management
  - machine-federation
  - follow-up
created: 2026-08-08
source: user
context:
  cwd: .
  branch: feat/session-inbox
  commit: 8d9a511
  repo: simonwjackson/forgerie
  invoked_by: user
---

# Establish a machine-global session domain boundary

## Why it matters

Session behavior currently spans workspace-local state, a duplicate global projection, fragmented HTTP snapshots, incomplete realtime identities, and workspace-scoped mutations. The session-inbox implementation needed 9,103 added lines across 33 files and late review still found state-divergence and race defects. A single domain boundary should make machine-global session features smaller, safer, and easier to verify.

## Acceptance Criteria

- [ ] Define one authoritative machine-scoped session aggregate covering inventory, live status, live activity, pending asks/dialogs, unread state, archive state, and machine identity.
- [ ] Return an atomic, versioned machine snapshot and document its consistency and reconnect semantics.
- [ ] Carry full machine-scoped SessionRef identity in every global realtime event; key client and server projections by the compound identity rather than sessionId alone.
- [ ] Provide machine-scoped open, create, archive, and restore APIs that accept SessionRef and do not require UI-driven project or workspace switching.
- [ ] Replace duplicate workspace/global synchronization with one authoritative client store plus explicit derived adapters for workspace views.
- [ ] Make the board, archive confirmation, Archive & next, attention counts, and navigation consume one canonical projection.
- [ ] Cover initial load, events during snapshots, reconnect, machine switching, duplicate session IDs, custom session directories, partial failures, and rolling client/server version skew with contract and integration tests.
- [ ] Measure and preserve bounded update behavior for high-frequency status/activity events without losing the final event per session.
- [ ] Record the architecture, migration sequence, compatibility policy, and removal criteria for superseded state and APIs.

## Related

- `src/shared/apiTypes.ts`
- `src/server/sessions/piSessionService.ts`
- `src/server/sessions/sessionRoutes.ts`
- `src/server/realtime/sessionEventHub.ts`
- `src/client/src/appState.ts`
- `src/client/src/controllers/sessionInboxController.ts`
- `src/client/src/controllers/sessionController.ts`
- `src/client/src/controllers/inboxNavigation.ts`
- `src/client/src/sessionBoard.ts`
- `src/client/src/components/PiWebApp.ts`
- `src/client/src/components/SessionInboxPanel.ts`
- `work/items/active/01KZFG0Y7GKA8H2XGYDE6WPSCM-session-inbox-primary-navigation/plan.md`

## Notes

This is a substantial architectural initiative. Promote to se-plan before implementation. Use the session-inbox branch as a concrete source of failure modes, but do not fold this migration into that feature. Capture finding: feature diff from baseline was 33 files, +9,103/-331; 5,379 added lines were tests and 3,724 were production/support code.
