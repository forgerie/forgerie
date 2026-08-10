---
id: 01KZMMQN2F307A35CS1DE17KTW
slug: make-archive-restore-and-deletion-failures-atomic
title: Make archive restore and deletion failures atomic
origin: parked
status: To Do
priority: high
labels:
  - sessions
  - archive
  - data-integrity
created: 2026-08-10
source: se-plan
---

# Make archive restore and deletion failures atomic

## Why it matters

SessionArchiveStore moves or deletes archived transcript files before it persists the updated index. If the index write then fails, restore can leave a transcript at its active path while the index still marks it archived, and bulk deletion can permanently remove transcripts while stale index records remain. The performance cache work must not hide this pre-existing data-integrity risk, but correcting mutation ordering is outside the confirmed performance scope.

## Acceptance Criteria

- [ ] Restore either commits both the transcript move and index update or rolls back to the archived state after index-write failure.
- [ ] Bulk archive deletion does not permanently unlink transcript files unless the index mutation can commit, or it has a tested rollback/recovery path.
- [ ] Archive copy failures do not leave untracked copies that can shadow newer source data on retry.
- [ ] Real-filesystem tests cover index-write failure after copy, move, and partial delete operations.

## Related

- `src/server/sessions/sessionArchiveStore.ts`
- `src/server/sessions/sessionArchiveStore.test.ts`
- `work/items/active/01KZMKYX9G4THPDDE08FYVF8GE-session-catalog-performance/plan.md`

## Notes

Discovered during the plan confidence pass. Keep separate from the catalog performance slice unless implementation proves cache safety cannot be isolated.
