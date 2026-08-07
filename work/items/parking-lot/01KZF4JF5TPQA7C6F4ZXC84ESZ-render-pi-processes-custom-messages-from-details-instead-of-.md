---
id: 01KZF4JF5TPQA7C6F4ZXC84ESZ
slug: render-pi-processes-custom-messages-from-details-instead-of-
title: Render pi-processes custom messages from details instead of raw model-facing XML
origin: parked
status: To Do
priority: medium
labels:
  - ux
  - transcript
  - forgerie
created: 2026-08-07
source: se-work
---

# Render pi-processes custom messages from details instead of raw model-facing XML

## Why it matters

Each `ad-process:notification` entry paints ~510 characters of `<process_event>` XML in the transcript when the same entry already carries a structured `details` object whose `summary` field says the same thing in ~87 characters — a 5.8x shrink, measured across 37 entries in one korri session. The markup is written for the model to parse, not for a human to read, and on the Fold 8 a single lifecycle event can fill most of a folded-landscape viewport. The server already forwards `customType` and `details` to the browser (piSessionService.ts:4216); the client discards them for every type except ASK_USER_ANSWERS_CUSTOM_TYPE (chatMessages.ts:197), so the fix is client-side only. Volume is low (0.9% of transcript characters) but the impact is concentrated and highly visible.

## Acceptance Criteria

- [ ] A custom_message with a details.summary renders as a compact card (status, process name, exit code, duration) instead of raw content
- [ ] The raw model-facing content stays reachable behind disclosure
- [ ] Unknown customTypes with no usable details fall back to today's raw-content rendering
- [ ] Survey which other extensions emit custom_message types with details before fixing the projection shape
- [ ] Verified across the four Fold 8 postures per AGENTS.md

## Related

- `src/client/src/chatMessages.ts`
- `src/server/sessions/piSessionService.ts`
- `src/client/src/components/ChatView.ts`

## Notes

Measured with /tmp/measure-custom-messages.mjs against the korri session 019fda49: 1,473 entries, 2,134,959 displayed chars, 37 ad-process:notification entries totalling 18,874 chars, all 37 carrying details. Note: an earlier measurement in-session reported 48.9% — that denominator was wrong (it missed entries nesting payload under `message`). 0.9% is the corrected figure.
