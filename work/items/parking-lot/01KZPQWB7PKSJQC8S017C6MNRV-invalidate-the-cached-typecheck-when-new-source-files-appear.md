---
id: 01KZPQWB7PKSJQC8S017C6MNRV
slug: invalidate-the-cached-typecheck-when-new-source-files-appear
title: Invalidate the cached typecheck when new source files appear
origin: parked
status: To Do
priority: medium
labels:
  - tooling
  - pre-commit
  - developer-experience
created: 2026-08-10
source: se-work
---

# Invalidate the cached typecheck when new source files appear

## Why it matters

The pre-commit hook runs `typecheck:cached` against a persistent `node_modules/.cache/forgerie/typecheck.tsbuildinfo`. When another file appears in the working tree after that cache was written, tsc reports phantom TS2304 "Cannot find name" errors in files the committer never touched, while a clean `tsc --noEmit` passes. That blocks an unrelated, correct commit and pushes the committer toward `--no-verify`, which is the one habit the hook exists to prevent. It cost a commit cycle today and will recur every time two sessions work in parallel.

## Acceptance Criteria

- [ ] A commit succeeds when an unrelated untracked source file has appeared since the tsbuildinfo was written
- [ ] The cached typecheck either keys its cache on the file set or falls back to a full typecheck when the set changes
- [ ] A stale-cache failure is distinguishable from a real type error in the hook's output

## Related

- `scripts/verify-staged.mjs`
- `package.json`

## Notes

Reproduced on main at 5ff4060: hook reported TS2304 for FOLLOW_TAIL/followTurn/FOLLOW_FREE in ChatView.image.test.ts while src/client/src/chatFollowMode.ts existed and exported all three. `npm run typecheck` (non-incremental) passed. Deleting the tsbuildinfo made the same commit pass unchanged.
