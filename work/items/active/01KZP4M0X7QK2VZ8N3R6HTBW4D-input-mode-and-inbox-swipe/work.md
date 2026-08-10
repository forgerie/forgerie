# Input mode, and a swipe to archive an inbox row

## Problem

The inbox gives the same controls to a finger and to a mouse.
`SessionInboxPanel.ts` holds `@media (hover: none) { .row-actions { opacity: 1; } }`.
On a touch device this pins a `✓` button to every row. The list carries a
column of buttons that the reader did not ask for.

A capability query also answers the wrong question. It reports what the device
can do. It does not report what the user does now. The test device is a Z Fold.
With a mouse connected, the device reports `any-pointer: coarse` and
`any-pointer: fine` at the same time. The query must then select one value, and
the selected value is wrong for one half of the work.

## Outcome

- A finger swipes a row to the left to archive it. No button is on the row.
- A mouse shows the action row on hover, as it does now.
- The two do not appear together.
- The mode follows the input in use, not the device.

## Constraints

- No user-agent test. No device-model test. No touch-support test.
- No new width breakpoint in the 499–979px posture range.
- The gesture must not take the vertical scroll from the reader.
- Archive already exists (`sessions.archive`), with an undo toast in the panel.
  This work adds a gesture. It does not add an operation.

## Out of scope

- A swipe to the right, and any second action.
- A long press for a menu.
- Any surface except the inbox row.

## Verification

`npm run verify`, then a posture capture with `scripts/capture-postures.mjs`.
