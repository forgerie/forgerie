# Tally logo candidates

Logo candidates drawn from the tally marks in the chat margin
(`ui/src/ui/TallyRow.css`). They do not replace `ui/public/favicon.svg` yet.

Every candidate uses the tally geometry: a mark is 7 units square, the gap is
3 units, the corner radius is a quarter of the mark, and a row holds three
marks. The failure and live colours are the app's `--tone-bad` and
`--tone-live`, converted from oklch to hex.

The first round compared Tally F, Rail F and The run. The run was chosen, with
the request that it read as the letter F. Tally F and Rail F are in Git
history at `b3a032da`.

| Candidate | Pattern | Idea |
| --- | --- | --- |
| The run (reference) | 3 × 3, 8 marks | The chosen first-round mark, kept for comparison. |
| Run F | 3 × 5, 8 marks | The run's marks and colours as an F. Red is in the spine, where it sat in the run. The live mark ends the middle arm. |
| Run F, coloured tips | 3 × 5, 8 marks | Red ends the top arm, as the falling piece does in the current mark. The spine is one colour. |
| Run F, short | 3 × 4, 7 marks | Coloured tips in four rows, so each mark is bigger. |

`build.mjs` defines each candidate as rows of text: `#` is a plain mark, `r`
a failed mark, `b` a live mark, and `.` an empty cell.

## Files

- `build.mjs` writes `marks/<id>-<light|dark>.svg` (maskable, glyph inside the
  80% safe circle), `marks/<id>-<scheme>-tab.svg` (tab icon, glyph fills the
  square) and `sheet.html`.
- `shoot.sh` runs `build.mjs`, captures `shots/sheet.png` at device scale 2,
  and rasterises each maskable mark to `shots/<id>-<scheme>-512.png` with
  resvg, the renderer `scripts/generate-icons.sh` uses.
- `tab-zoom.sh` writes `shots/tab-zoom.png`: each tab icon at 42 px (16 CSS px
  on the Fold) and at 16 px, enlarged with no smoothing.

## Findings

- At 42 px, the Fold's tab size, every Run F reads as an F with clear marks.
- At 16 px, the rows do not land on whole pixels, so plain marks turn grey.
  The five-row candidates hold up better than the short one. A hand-drawn
  16 px file on a 3 px pitch would make the marks sharp.
- A bold F with a two-mark spine (4 × 5, 14 marks) was tried and dropped. At
  16 px its marks merged into grey stripes.

## Adopt one

Copy the chosen `marks/<id>-light.svg` over `ui/public/favicon.svg`, then run
`scripts/generate-icons.sh`. The tab icon variant needs a separate `<link
rel="icon">` if the tab and the PWA icons should differ.
