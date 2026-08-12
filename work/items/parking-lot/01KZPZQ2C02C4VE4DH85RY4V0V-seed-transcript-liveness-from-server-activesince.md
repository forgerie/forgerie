---
id: 01KZPZQ2C02C4VE4DH85RY4V0V
slug: seed-transcript-liveness-from-server-activesince
title: Seed transcript liveness from server activeSince
origin: parked
status: To Do
priority: low
labels:
  - chat
  - reconnect
  - runtime
created: 2026-08-10
source: se-code-review
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: feat/working-runtime
  repo: forgerie
---

# Seed transcript liveness from server activeSince

## Why it matters

The transcript still starts its local liveness clock when the browser observes work. A reload during a running turn therefore resets the transcript runtime even though the new SessionActivity.activeSince contract now carries the continuous turn start.

## Acceptance Criteria

- [ ] ChatView prefers a valid SessionActivity.activeSince when it enters active state.
- [ ] A reconnect or reload during a running turn preserves the transcript runtime.
- [ ] Focused ChatView tests cover server-provided and fallback starts.

## Related

- `src/client/src/components/ChatView.ts`
- `src/shared/apiTypes.ts`
