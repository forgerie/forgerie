---
id: 01KZRYRH8AP4HCQA18H4S3NMRV
slug: give-the-client-a-radius-scale-instead-of-literal-corners
title: Give the client a radius scale instead of literal corners
origin: parked
status: To Do
priority: low
labels:
  - client
  - design-tokens
  - style-guide
created: 2026-08-11
source: se-work
---

# Give the client a radius scale instead of literal corners

## Why it matters

Every corner in the client is a literal: 8px appears 16 times in shared.ts alone, alongside 999px, 10px, 7px, 6px, 5px, 4px, 2px, 14px and 16px. The theme contract in theme.ts carries colour tokens only, so radius cannot be themed and cannot vary with a plugin theme. The style guide requires a comment whenever a radius is hardcoded, which the new peek sheet now carries — that comment is the third such apology in the file and marks a missing token rather than a local exception. A small named scale would let surfaces (sheets, dialogs), controls (buttons, inputs) and pills read their corner from one place, and would let a theme change the app's character rather than only its colours.

## Acceptance Criteria

- [ ] A radius scale exists alongside the other design tokens and is documented where THEME_TOKENS is defined
- [ ] shared.ts, the dialogs and the peek sheet read their corners from the scale
- [ ] The peek sheet's inline comment explaining the absent token is deleted
- [ ] A theme contribution can override the scale, or the docs state plainly that radius is not themeable and why

## Related

- `src/client/src/components/shared.ts`
- `src/client/src/theme.ts`
- `prototypes/panel-peek/README.md`
