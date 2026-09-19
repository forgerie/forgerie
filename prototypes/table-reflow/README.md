# table-reflow — four ways to read a two-column table

The shipped stacking works and is still unpleasant to read. The complaint that
started this: *"I feel like I want to skip over them."* This prototype takes
the exact table from that screenshot — `Outcome | What success means`, three
rows — and renders it four ways in a real transcript column.

```bash
# from prototypes/
node serve.mjs . 8600   # then open http://127.0.0.1:8600/table-reflow/#pairs
CHROME_BIN=/path/to/chrome node table-reflow/capture.mjs   # posture screenshots
CHROME_BIN=/path/to/chrome node table-reflow/measure.mjs   # block heights
```

## What is wrong with the shipped rendering

Two faults, both visible in `current-folded.png`:

1. **The column heading is repeated once per record.** "What success means"
   appears three times and carries no information after the first. With three
   records it is a third of the block's lines.
2. **The block is dressed as a table while giving none of a table's use.** An
   uppercase caption, a rule above, a rule below, a rule between each record —
   table chrome around what is now three sentences. The eye reads it as a
   thing to skip, because it looks like reference material rather than the
   argument being made.

The cost is height. Block height for the same three rows, measured with
`measure.mjs`:

| Posture | current | A pairs | B prose | C rows |
|---|---|---|---|---|
| Unfolded portrait (704) | 284px | 169px | 151px | 229px |
| Unfolded landscape (932) | 286px | 171px | 153px | 231px |
| Folded portrait (475) | 347px | 233px | 148px | 263px |
| Folded landscape (711) | 284px | 169px | 151px | 229px |

On the folded phone the shipped block pushes the question that follows it off
the screen. Every treatment here keeps that question visible.

## The treatments

**A · pairs** (`#pairs`) — name in the prose weight, meaning under it in muted
ink, one hairline down the start edge to say where the list begins. The second
column's heading moves into the sentence above the block, so it is said once.
This is the shape shipped apps use for exactly this content (Wise, Whatnot,
Tide Guide on Mobbin): title plus one-line meaning, no field label per row.
Cost: comparison down a column is gone, and the block still reads as a block.

**B · prose** (`#prose`) — no block at all. Each record is one line: bold
lead-in, meaning in the same sentence, an em dash marker. Cheapest and
shortest (57% shorter than shipped at folded portrait). Cost: the meanings no
longer line up, so a record with a long name and a long meaning reads as one
grey run. It degrades with more than about four records, or with meanings
longer than a line.

**C · rows** (`#rows`) — still a table. Two wrapping tracks, the heading row
shown once, values allowed to wrap instead of scroll. Comparison down the
column survives, which is the one thing stacking throws away. Under 26rem of
container the second track cannot hold a sentence, so a record folds to the
A shape — same grammar, one track instead of two. Cost: 229px against prose's
151px, and narrow names leave ragged space in the first track.

## The finding underneath the treatments

**C is possible at the width where the shipped code stacks.** `rows-wide.png`
shows two real columns inside the reading column with no horizontal scroll,
because the cells are allowed to wrap.

*Inferred, not yet verified against the renderer:* the shipped trigger cannot
see that. `formatting/tableReflow.ts` compares `table.scrollWidth` with the
wrapper width, and `shared.ts` sets `table { width: max-content }` with
`th, td { max-width: 48ch }`. A cell holding a sentence therefore measures
48ch wide, so a two-column table of sentences wants about 690px at
`--pi-text-sm` and the unfolded-portrait wrapper offers about 608px. It stacks
every time, not because it does not fit, but because it is measured unwrapped.
If that holds, the smallest real fix is to measure a wrapped fit — or lower the
per-cell cap — before reaching for the stack.

## Recommendation

Ship **A** as the stacked form: it is the smallest change to the existing CSS
(drop the per-record label and the record caption, keep the records) and it
fixes the repetition that makes the block skippable. Add **C** in front of it,
so a two-column table stays a table whenever wrapping makes it fit, and
stacking becomes the rare case it was meant to be. Keep **B** for the case of
a two-column table whose first column is a short key — it is the only one that
disappears into the prose completely, which is right when the table was never
reference material in the first place.
