---
id: 01M0DP6Z5S9NTAGMXEZT43RTPT
slug: eliminate-happy-dom-teardown-errors-in-full-vitest-runs
title: Eliminate Happy DOM teardown errors in full Vitest runs
origin: parked
status: To Do
priority: medium
labels:
  - testing
  - performance
  - reliability
created: 2026-08-19
source: user
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: main
  commit: 677dfbe
  repo: forgerie
---

# Eliminate Happy DOM teardown errors in full Vitest runs

## Why it matters

Full and coverage runs emit many aborted fetch and socket errors. One final coverage run failed with three unhandled window teardown errors before an immediate retry passed. This noise adds flake risk and hides real failures.

## Acceptance Criteria

- [ ] Full Vitest and coverage runs complete repeatedly without unhandled Happy DOM teardown errors.
- [ ] Tests still fail when an unexpected network or timer error occurs.
- [ ] The fix does not hide logs from failing tests.

## Related

- `src/client/src/components/PiWebApp.ts`
- `vitest.config.ts`
- `docs/testing.md`
