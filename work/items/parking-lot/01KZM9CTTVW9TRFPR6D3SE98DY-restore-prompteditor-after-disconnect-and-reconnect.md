---
id: 01KZM9CTTVW9TRFPR6D3SE98DY
slug: restore-prompteditor-after-disconnect-and-reconnect
title: Restore PromptEditor after disconnect and reconnect
origin: parked
status: To Do
priority: medium
labels:
  - frontend
  - reliability
  - composer
created: 2026-08-09
source: se-code-review
context:
  cwd: .
  branch: feat/composer-live-dictation
  repo: forgerie
---

# Restore PromptEditor after disconnect and reconnect

## Why it matters

PromptEditor destroys its CodeMirror EditorView on disconnect, but Lit does not rerun firstUpdated when the same element reconnects. A remounted element instance can therefore lose typing, focus, plugin insertion, and dictation until recreated.

## Acceptance Criteria

- [ ] Disconnect and reconnect the same PromptEditor instance without losing a usable CodeMirror editor.
- [ ] Add a regression test covering focus and text insertion after reconnect.

## Related

- `src/client/src/components/PromptEditor.ts`
