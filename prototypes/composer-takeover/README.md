# Composer takeover

One input surface. When `ask_user` opens a question set, the bottom composer
stops being a message box and becomes the answer tool in place. There is never
a second place to type, and the page never scrolls to reach a control.

This replaces the split the fork inherited: an `AskUserCard` with its own
inputs somewhere in the transcript, plus the real composer at the bottom. On a
folded screen you could not tell which one wanted your text.

## What is being proposed

- While `pendingAsk` is set, the composer is the ask tool and nothing else. No
  free-form send, no slash commands.
- A half-typed message is stashed on open and restored on close.
- The transcript keeps a passive record with no inputs.
- Leaving a question blank stays reachable at every size.

## What is not being proposed

A new visual language. The card, the uppercase accent heading, the numbered
questions, the radio and checkbox options that fill on check, the primary Send
button: all copied from the shipped `AskUserCard`. Only the position and the
adaptation are new. Where a size forces a change it is a change of density or
arrangement, never of style.

Light only (Forgerie Light, "Paper"). This prototype argues about layout, and
carrying both palettes would mean judging every size twice for one answer.

## Running it

```bash
cd prototypes
node serve.mjs . 8600 0.0.0.0
```

- Live: <http://zao:8600/composer-takeover/>
- Size ladder: <http://zao:8600/composer-takeover/ladder.html>

`?fixture=single|few|many` opens a set on load. `many` is the worst case the
contract allows: 20 questions of 12 options. The floating probe switches sets,
fakes a keyboard for desktop judging, and prints the live plan output. On a real
phone the keyboard needs no faking, because the layout reads the visual
viewport.

## It lays out on the reading column

The card is not full-bleed. It takes `--calm-measure` (`min(36rem, 100cqi - 2 *
--calm-gutter)`), the same column the transcript uses, and lets its own chrome
hang into the 32px gutter so the question text starts on the same edge as the
prose above it. At 932px wide the column is 576px and the question text lands at
x=178, which is exactly where the transcript prose starts.

This is the shipped rule, not a new one. `src/client/index.html` says every
surface laying out on this column has to arrive at one number, and records what
happened when the composer and the transcript each computed their own: they
disagreed by 26px on a folded phone, and the alignment came apart where the
screen is tightest.

The consequence for layout is larger than it looks. `plan()` is handed the
column width, not the viewport width, so the honest range is about 256px on a
320px screen up to 576px on anything wider. Every width threshold was recalibrated
against that range. The old numbers had been chosen against viewport widths this
layout never sees, which made two of them unreachable.

## The layout is one function

`plan(width, height, model)` in [`plan.mjs`](./plan.mjs) returns the whole
layout: structure, height budget, option form, the inline/overflow split. The
live page and every frame of the ladder execute it, so no picture here can
disagree with the code. Porting it to production should be a copy, not a
rewrite, and every threshold in `THRESHOLDS` is a place to unit-test one pixel
either side.

Height decides structure, because height is what the keyboard takes:

| Height | Structure | Shape |
|---|---|---|
| >= 520 | `sheet` | Whole set, scrolls inside its budget |
| 300-519 | `paged` | One question, pager, full block |
| < 300 | `strip` | One question, options packed inline, title yields |

Width decides content: option tracks, whether the question sits beside the
options, how much of the progress readout survives, and whether skip stays
inline. Inside a capped column, width is never plentiful enough to buy a text
field beside the options in a strip, so free text opens full size from the
overflow menu there. One tap, not one fewer capability.

## Capture

```bash
CHROME_BIN=$(command -v chromium) node capture.mjs --out /tmp/ct --fixture many
```

Ten sizes over CDP emulation, including the four acceptance postures with a
keyboard up. Never `--window-size`: a Chromium window is not a viewport, and the
difference invents clipped-control defects the device does not have.

## Defects the ladder caught

Each of these was invisible in the code and obvious in a render.

1. **932x300 wasted its width.** A 33-character label failed a label-length gate
   and forced every option to a full-width row, so two options ate the height
   while 900px sat empty. The gate is gone; the grid track now grows with the
   longest label and `auto-fit` picks the column count.
2. **320x480 pushed the submit button off the right edge.** The footer now wraps,
   and the "1 / 20" position readout folds away before the arrows do.
3. **A question and its detail shared a row at 320px**, giving 150px to each. The
   prompt is a grid now: question and detail-opener on row one, detail below.
4. **Skip appeared with no pager** in `sheet`, where it had nothing to skip to.
   It exists only while paged.
5. **A capped region read as clipped.** Content stopping at the budget line
   looked broken, so the body fades at the edge while more remains.
6. **The row divider had holes in it.** Drawing it as the fieldset's `border-top`
   let the `<legend>` notch cut through, leaving stubs at both edges. It is an
   inset box-shadow now, which nothing notches.
7. **The wide strip collapsed to a narrow column.** A `<legend>` does not take
   part in its fieldset's grid, so the question kept the full width and the
   options were squeezed into the right third. Questions are labelled groups
   now, and the two-column strip works.
8. **The card ignored the reading column.** It ran the full width of the frame,
   so at 932px it was 300px wider than the transcript above it and started on a
   different edge. It takes the column now, and `plan()` measures the column
   through a zero-height probe rather than the card, because the card's padding
   changes with the plan and measuring it would feed the layout into its own
   input.

## Open questions

The height budget shares (62% / 66% / 82%) are guesses. They decide how much
transcript survives beside an open question, and nothing here proves those are
the right numbers on a real device in a real conversation.

At 320x480 with a long question and a detail line, the prose eats the body and
only one option is visible before scrolling. Everything stays reachable, but the
detail may deserve to move behind its opener whenever the column is narrow, not
only at strip height.
