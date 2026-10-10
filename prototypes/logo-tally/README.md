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

The fourth round (`d39a570e`) drew square blocks with equal arms. An
annotated review of that round set two anchors for this one. In both, the F
is black only, and the red and blue marks sit at the edge of the block,
outside the F.

- Anchor A: a 5 × 5 block. The F is three marks wide: the spine plus two
  marks in each arm. Light grey fills the rest.
- Anchor B: the run's own F. Its five black marks make a 2 × 2 head on a
  stem.

| Candidate | Pattern | Idea |
| --- | --- | --- |
| The run (reference) | 3 × 3 | The chosen first-round mark. |
| A · F left, colours bottom right | 5 × 5 | Red and blue stack in the bottom-right corner. |
| A · F centred, run corners | 5 × 5 | Red on the left edge at the run's height; blue in the bottom-right corner. |
| A · F right, colours left | 5 × 5 | Red and blue take the left column. |
| A · F left, colours on the floor | 5 × 5 | Red and blue end the bottom row. |
| B · The run, as annotated | 3 × 3 | Blue and red in the left column, blue in the bottom-right corner, one empty cell. |
| B · Filled | 3 × 3 | Grey replaces the empty cell and the top-left blue. |
| B · Colours left | 3 × 3 | Blue and red in the left column; the other cells are grey. |
| B · 4 × 4, wide head | 4 × 4 | A 3 × 2 head on a stem. |
| B · 4 × 4, narrow head | 4 × 4 | A 2 × 2 head on a longer stem. |

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
  resvg, the renderer `scripts/generate-icons.mjs` uses.
- `tab-zoom.sh` writes `shots/tab-zoom.png`: each tab icon at 42 px (16 CSS px
  on the Fold) and at 16 px, enlarged with no smoothing.

## Findings

- Anchor A reads as an F at every size down to 16 px, because the gap row
  between the arms stays visible.
- Anchor B keeps the run's large marks, but its head has no gap between the
  arms. At 3 × 3 it can read as a P or a block as easily as an F. The
  4 × 4 versions have a longer stem and read more clearly as an F.
- On the home-screen icon, 4 × 4 marks are 30% smaller than the run's, and
  5 × 5 marks are 45% smaller.
- `explore.sh` writes `shots/explore.png`, every candidate at 256 px, light
  and dark, in the table's order.

## Adopt one

Copy the chosen `marks/<id>-light.svg` over `ui/public/favicon.svg`, then run
`scripts/generate-icons.mjs`. The tab icon variant needs a separate `<link
rel="icon">` if the tab and the PWA icons should differ.
