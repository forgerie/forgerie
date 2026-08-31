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
| < 300 | `strip` | One question, chips, everything on two rows |

Width decides content: option columns, whether the question sits beside the
options, how much of the progress readout survives, and whether skip and free
text stay inline.

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

## Open question

The height budget shares (62% / 66% / 82%) are guesses. They decide how much
transcript survives beside an open question, and nothing here proves those are
the right numbers on a real device in a real conversation.
