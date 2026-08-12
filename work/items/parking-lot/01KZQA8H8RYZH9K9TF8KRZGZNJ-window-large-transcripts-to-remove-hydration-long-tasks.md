---
id: 01KZQA8H8RYZH9K9TF8KRZGZNJ
slug: window-large-transcripts-to-remove-hydration-long-tasks
title: Window large transcripts to remove hydration long tasks
origin: parked
status: To Do
priority: medium
labels:
  - performance
  - chat
  - frontend
created: 2026-08-11
source: se-work
context:
  cwd: .
  branch: main
  commit: eaedaadeaa7f
  repo: forgerie
  invoked_by: instant-chat-opening
  issue_ref: 01KZPX4SZA0VMNWMTZT3GJ4R69
---

# Window large transcripts to remove hydration long tasks

## Why it matters

The deployed instant-chat probe kept shell paint below 16 ms, but representative transcript hydration still produced 55–59 ms long tasks in three Fold postures and 74–78 ms on two cross-workspace runs. These do not block this feature by explicit decision, but they can still cause visible input or scroll jank after the shell appears.

## Acceptance Criteria

- [ ] The browser renders only a bounded visible transcript window during initial hydration.
- [ ] Large tool outputs hydrate lazily without changing transcript order or scroll-anchor behavior.
- [ ] The deployed four-posture probe reports no task over 50 ms between shell paint and fresh transcript paint for the representative large session.
- [ ] Existing paging, follow mode, turn anchoring, and ask/dialog placement tests remain green.

## Related

- `work/items/active/01KZPX4SZA0VMNWMTZT3GJ4R69-instant-chat-opening/plan.md`
- `scripts/probe-chat-open.mjs`
- `src/client/src/components/ChatView.ts`
- `src/client/src/chatTranscriptStore.ts`

## Notes

Observed on 2026-08-10: large transcript long tasks 59 ms (unfolded portrait), 56 ms (folded portrait), and 55 ms (folded landscape); cross-workspace long tasks 74 ms and 78 ms. The <100 ms shell gate passed at 8.7–15.7 ms with no old-transcript flash.
