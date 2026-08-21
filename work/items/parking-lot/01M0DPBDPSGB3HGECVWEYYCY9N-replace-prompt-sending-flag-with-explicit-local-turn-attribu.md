---
id: 01M0DPBDPSGB3HGECVWEYYCY9N
slug: replace-prompt-sending-flag-with-explicit-local-turn-attribu
title: Replace prompt sending flag with explicit local turn attribution
origin: parked
status: To Do
priority: medium
labels:
  - client
  - chat
  - scroll
  - reliability
created: 2026-08-19
source: se-code-review
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: fix/open-chat-at-bottom
  commit: 66daff9
  repo: forgerie
  invoked_by: se-work
---

# Replace prompt sending flag with explicit local turn attribution

## Why it matters

Chat turn anchoring uses `sendingPrompts` as a one-shot local-send signal. Plain text sends do not set it, and failed attachment sends can leave stale attribution until another user turn arrives.

## Acceptance Criteria

- [ ] Represent local turn intent separately from the user-visible upload indicator.
- [ ] Anchor plain text, attachment, queued opening, command, and shell turns only when their matching local send creates the turn.
- [ ] Clear failed or cancelled send intent without misclassifying later remote turns.
- [ ] Add integration tests through the real PiWebApp and SessionController send paths.

## Related

- `src/client/src/components/ChatView.ts`
- `src/client/src/components/PiWebApp.ts`
- `src/client/src/controllers/sessionController.ts`
- `src/client/src/appState.ts`

## Notes

Pre-existing limitation confirmed while preserving live prompt anchoring during bottom-first chat opening.
