---
id: 01KZPZQ2C38SBSFDZ8K6AWG0BT
slug: make-working-runtimes-independent-of-device-clock-skew
title: Make working runtimes independent of device clock skew
origin: parked
status: To Do
priority: low
labels:
  - sessions
  - runtime
  - remote-machines
created: 2026-08-10
source: se-code-review
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: feat/working-runtime
  repo: forgerie
---

# Make working runtimes independent of device clock skew

## Why it matters

Working runtimes subtract a server ISO timestamp from the browser clock. Material clock skew between a remote machine and the client can understate or overstate the displayed duration.

## Acceptance Criteria

- [ ] The wire contract provides a duration or server observation time that does not depend on synchronized clocks.
- [ ] The browser advances the baseline with a local monotonic clock.
- [ ] Tests cover server clocks ahead of and behind the browser.

## Related

- `src/client/src/components/SessionWorkingRuntime.ts`
- `src/server/sessions/piSessionService.ts`
- `src/shared/apiTypes.ts`
