---
id: 01KZST34VJQF4T8D421J9ZENMS
slug: define-timeout-recovery-for-wedged-pi-prompt-runtimes
title: Define timeout recovery for wedged Pi prompt runtimes
origin: parked
status: To Do
priority: medium
labels:
  - reliability
  - sessions
  - prompt-delivery
created: 2026-08-12
source: se-code-review
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: feat/shared-session-composer
  commit: 54eee5d
  repo: forgerie
---

# Define timeout recovery for wedged Pi prompt runtimes

## Why it matters

A prompt preflight timeout now bounds the HTTP receipt, but an adapter whose prompt promise never settles must remain marked active because it can still mutate transcript state. A safe recovery needs an explicit Pi cancellation or runtime-replacement contract rather than clearing Forgerie's mutation gate and risking concurrent session writes.

## Acceptance Criteria

- [ ] Specify whether timeout should call Pi abort, replace the runtime, or expose an operator recovery action.
- [ ] Prove late transcript writes cannot overlap tree, reload, archive, or a replacement prompt.
- [ ] Add contract tests for a permanently wedged prompt runtime and the chosen recovery action.

## Related

- `src/server/sessions/piSessionService.ts`
- `src/server/sessions/piSessionService.promptQueue.test.ts`
