---
id: 01M0GEDX96156VPC0GV0GZDQWA
slug: design-the-promotion-moment-when-a-turn-closes
title: Design the promotion moment when a turn closes
origin: parked
status: To Do
priority: medium
labels:
  - chat
  - ui
  - motion
created: 2026-08-20
source: se-work
---

# Design the promotion moment when a turn closes

## Why it matters

When a turn completes, the last interim block leaves the rail and brightens to full voice in one render. The interim-voice study flagged the rail variant as hiding this transition worst. Untreated, the reader sees a block jump position and restyle with no continuity. A designed transition (opacity/transform, reduced-motion-guarded) or a deliberate decision that the cut is fine should close this.

## Acceptance Criteria

- [ ] A recorded decision: animated transition or deliberate hard cut
- [ ] Any motion is prefers-reduced-motion guarded
- [ ] Verified on device across fold/unfold during a live turn completion

## Related

- `src/client/src/components/shared.ts`
- `prototypes/interim-voice/README.md`
