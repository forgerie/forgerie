---
id: 01M1DZ0000000000000000000B
slug: chat-views-take-plain-props
title: Chat views take plain props; only the binding reads the assistant-ui runtime
origin: parked
status: To Do
priority: high
labels:
  - ui
  - decomposition
  - follow-up
created: 2026-10-08
source: user
---

# Chat views take plain props; only the binding reads the assistant-ui runtime

## Why it matters

The decomposition of `ui/` uses decision A: the chat views in `ui/src/chat/`
read assistant-ui's runtime context directly, through a named exception in
`ui/gates/layers.test.ts`. atomic-decomp says that only a binding reads state.
The user chose A first and B as a fast follow-up, to start after A is approved.

## Acceptance criteria

- [ ] The chat binding is the only file that reads the assistant-ui runtime. It passes messages, the composer state and handlers to the chat views as plain props.
- [ ] No chat shape or part uses `useAui`, `useAuiState`, `useAuiEvent`, `AuiIf`, `unstable_use*` or a `*Primitive` component.
- [ ] The `RUNTIME_READ` exception and `readsRuntimeByDecision` are deleted from `ui/gates/layers.test.ts`, and the gates pass.
- [ ] Chat parts render from fixture props alone, with no runtime provider.
- [ ] Streaming, auto-scroll, the composer, attachments, mentions, slash commands, dictation, ask and extension dialogs behave as before. The existing `ui/` tests and acceptance scripts pass.
- [ ] Posture captures of a live session match A's captures in all four Fold 8 postures and both colour schemes.

## Related

- `ui/docs/decomposition.md`, section "Chat views and the assistant-ui runtime"
- `ui/gates/layers.test.ts`

## Notes

Expect the largest regression risk in streaming and the composer. Plan it as
its own lane, with a test baseline recorded before the first change.
