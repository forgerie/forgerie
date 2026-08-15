---
id: 01M03E03JY0YHKEEZHJJFD8Y8X
slug: stabilize-pisessionservice-defaults-tests-under-full-suite-l
title: Stabilize PiSessionService defaults tests under full-suite load
origin: parked
status: To Do
priority: medium
labels:
  - testing
  - flake
created: 2026-08-15
source: se-debug
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: main
  repo: forgerie
---

# Stabilize PiSessionService defaults tests under full-suite load

## Why it matters

`npm run verify` timed out in `src/server/sessions/piSessionService.defaults.test.ts` on two consecutive full-suite runs, while the same five tests passed in 220ms when run alone. This prevents a reliable green whole-repo gate and can hide real regressions behind load-dependent failures.

## Acceptance Criteria

- [ ] `npm run verify` completes without timeouts in `piSessionService.defaults.test.ts` across repeated runs.
- [ ] The tests keep their current behavioral assertions and do not rely on a blanket timeout increase unless the measured runtime justifies it.
- [ ] The root cause of the full-suite-only delay is documented in the test or its fixture seam.

## Related

- `src/server/sessions/piSessionService.defaults.test.ts`
