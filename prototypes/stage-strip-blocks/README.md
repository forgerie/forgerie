# The run strip, in blocks

Three candidates for the workflow run strip above the composer
(`ui/src/ui/StageStrip.tsx`), redrawn with the tally block from the chat
margin and the brand mark: a 7-unit square, a 3-unit gap, corners a quarter
of the mark. None of them replaces the shipped strip yet.

Open `board.html` for every candidate at every size. `board.html?only=A`
shows one candidate; `?scheme=light` switches the palette; `?still` stops
the blink. `./render.sh dark` (or `light`) writes `shots/`. Only
`shots/board-dark.png` is in Git.

| Key | Candidate | Idea |
| --- | --- | --- |
| A | The mark | One row. A block grid in the icon's place: a column per stage, a block per worker, stacked from the floor. The bar row goes away. |
| B | Stage cells | A block cell per stage, workers as marks inside. Stages at work take the width their names need. |
| C | The ledger | The chat tally as is: one block per worker run and per stop, in order, a one-block gap between stages, outlines for what is planned. |

## Rules all three follow

- Colours are the tally's, not today's strip: done is plain ink
  (`--meter-ink`), working is blinking live, waiting for you is solid live
  with a wash ring, failed is `--tone-bad`, not reached is an outline.
- Layout is one `plan(width, height)` per candidate, with thresholds in `T`.
  The board runs it at 720, 440 and 300 wide, at 720 in a short session, and
  at 454 beside a reply and the composer.
- The title drops below 480 px and the short-session layout starts below a
  448 px session height, both as today. These are guesses until measured.

## Content

The run is `coach-mvp-e2e` from a screenshot on 2026-10-13: six stages, three
with two workers, status "Integrate, Land and deploy, 2 working". The names
Integrate and Land and deploy come from that screenshot. Research, Contract,
Engine and UI, Device test, the retry in Engine and UI, and the elapsed
times are invented.

## Data C needs that the strip does not get today

`stripSegments()` gives one state per declared worker. The ledger needs one
entry per child run and per stop round, in order. `run.children` and
`run.stops[].round` carry it, so this is a model change, not a server change
(inferred from `ui/src/workflows/workflowsModel.ts`, not built).
