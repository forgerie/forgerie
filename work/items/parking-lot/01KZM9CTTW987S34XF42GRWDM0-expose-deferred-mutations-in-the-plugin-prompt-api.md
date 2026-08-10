---
id: 01KZM9CTTW987S34XF42GRWDM0
slug: expose-deferred-mutations-in-the-plugin-prompt-api
title: Expose deferred mutations in the plugin prompt API
origin: parked
status: To Do
priority: low
labels:
  - plugins
  - api
  - dictation
created: 2026-08-09
source: se-code-review
context:
  cwd: .
  branch: feat/composer-live-dictation
  repo: forgerie
---

# Expose deferred mutations in the plugin prompt API

## Why it matters

During active dictation, plugin prompt insertions are intentionally drained and queued. The current void insertText contract gives plugins no way to know the mutation is deferred, so an immediate getText call can observe stale draft text.

## Acceptance Criteria

- [ ] Plugin callers can distinguish immediate, deferred, and unavailable prompt insertions without breaking existing plugins.
- [ ] Document dictation-time behavior in the plugin prompt contract.
- [ ] Add a contract test for insertText followed by state/text observation during dictation.

## Related

- `src/client/src/components/PiWebApp.ts`
- `src/client/src/components/PromptEditor.ts`
- `docs/plugins.md`
