# Plan

`verify_command: npm run verify`

## Design

Two separate mechanisms. Each answers a different question.

**The gesture asks the event.** A pointer event carries `pointerType`. The
swipe handler acts only when the value is `"touch"`. The handler needs no
global state, and no query about the device.

**The affordance asks the root.** CSS cannot read an event. One module records
the most recent input type on the root element as a custom property. The
property inherits through the shadow boundary, which is the method that
`src/client/src/theme.ts` already uses for the theme tokens.

The action row becomes `display: none` in touch mode. Transparency is not
enough: on iOS a `:hover` rule stays active after a tap, so a transparent row
becomes visible and stays visible.

## Unit 1 — the input mode module

New `src/client/src/inputMode.ts`.

- `observeInputMode(root, doc)` adds a capturing `pointerdown` listener and a
  capturing `keydown` listener. It returns a function that removes both.
- A `pointerdown` with `pointerType === "touch"` selects touch mode. Any other
  value selects mouse mode.
- The module writes `--pi-row-actions-display` to the root: `none` for touch,
  `flex` for mouse.
- The start value is mouse. Neither affordance is visible when at rest, so the
  start value shows nothing incorrect. The first touch corrects it.

Tests: a fake root and a fake document. Confirm each transition, and confirm
that the returned function removes the listeners.

## Unit 2 — the gesture arithmetic

New `src/client/src/rowSwipe.ts`. Pure functions, no DOM.

- `readSwipe(dx, dy, config)` returns `{ offset, engaged, willArchive }`.
- Engaged when `|dx| >= engagePx` and `|dx| > |dy|`. The second test keeps a
  vertical scroll out of the gesture.
- `offset` is `0` until engaged, then the leftward part of `dx`. A rightward
  drag gives `0`, because this work has one direction.
- `willArchive` when `-offset >= commitPx`.

Tests: each threshold, the diagonal case, the rightward case, and zero.

## Unit 3 — the row

Change `src/client/src/components/SessionInboxPanel.ts`.

- Delete the `@media (hover: none)` rule.
- `.row-actions` takes `display: var(--pi-row-actions-display, flex)`.
- Add `touch-action: pan-y` to `.row`. The browser then keeps the vertical
  scroll and gives the horizontal movement to the handler.
- `pointerdown`: ignore a pointer that is not touch. Record the start point.
  Call `setPointerCapture`.
- `pointermove`: read the swipe. Move the row by `offset`. Show the archive
  mark behind the row.
- `pointerup`: archive when `willArchive` is true. If not, return the row to
  its place.
- `pointercancel`: return the row to its place.
- A swipe must not select the session. Suppress the click that follows a
  gesture that engaged.

## Unit 4 — the postures

Capture the four postures with `scripts/capture-postures.mjs`. Read each image.
Confirm that no row carries a button in touch mode, and that the row keeps its
height.
