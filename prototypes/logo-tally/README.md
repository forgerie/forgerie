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

The second round (`07d06a58`) drew skeleton F shapes, 3 × 5 and 3 × 4, with
about half the cells empty. They read as an F but lost the run's weight: the
run fills 8 of 9 cells, and its marks were about 30% larger.

The third round (`aa711013`) tried heavy-head, toned and outlined Fs. The
feedback set four rules for this round: the block is square (as many marks
across as down), both arms of the F are the same length, there are no
outline marks, and the grey cells are light so the F stands out.

| Candidate | Pattern | Idea |
| --- | --- | --- |
| The run (reference) | 3 × 3, 8 marks | The chosen first-round mark, kept for comparison. |
| 4 × 4, full arms | 16 cells, F of 10 | Both arms run the full width. |
| 4 × 4, short arms | 16 cells, F of 8 | Both arms stop one mark short; a grey column frames the F. |
| 5 × 5, full arms | 25 cells, F of 13 | Taller F, longer stem, full-width arms. |
| 5 × 5, short arms | 25 cells, F of 11 | The 5 × 5 F with both arms one mark short. |
| 5 × 5, bold spine | 25 cells, F of 17 | A two-mark spine with full-width arms. |

Red sits in the spine, as in the run. The live mark ends the middle arm.

A 3 × 3 F with equal arms is not possible: the two arms need a gap row
between them, so the F needs at least four rows.

`build.mjs` defines each candidate as rows of text: `#` is a plain mark, `r`
a failed mark, `b` a live mark, `g` a grey mark, `o` a faint outline, and
`.` an empty cell. `explore.sh <id>...` puts candidates' 512 px icons side by
side for quick comparison.

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

- At 42 px (16 CSS px on the Fold), every square F reads as an F.
- At 16 px, the 4 × 4 marks blur at the edges but the F holds. The 5 × 5
  marks are about 2 px each and the F is only just readable.
- The grey is `#e6e2d9` on light paper and `#26272a` on dark. It keeps the
  square block visible without competing with the F.
- On the home-screen icon, 4 × 4 marks are 30% smaller than the run's, and
  5 × 5 marks are 45% smaller (scale 14 and 11 against 20).

## Adopt one

Copy the chosen `marks/<id>-light.svg` over `ui/public/favicon.svg`, then run
`scripts/generate-icons.sh`. The tab icon variant needs a separate `<link
rel="icon">` if the tab and the PWA icons should differ.
