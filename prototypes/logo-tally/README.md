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
run fills 8 of 9 cells, and its marks were about 30% larger. This round keeps
the run's density and draws the F inside it.

| Candidate | Pattern | Idea |
| --- | --- | --- |
| The run (reference) | 3 × 3, 8 marks | The chosen first-round mark, kept for comparison. |
| Run F, heavy head | 3 × 4, 9 marks | The run's first two rows, unchanged. The last row drops into a stem; the live mark is the middle arm. |
| Run F, toned | 3 × 4, 12 marks | A full block. The F is in ink and the other marks are the chat's grey. |
| Run F, ghost cells | 3 × 4, 7 marks and 5 outlines | A full block. The cells outside the F are the chat's faint outline marks. |

Red stays where the run has it in every candidate.

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

- A four-row glyph must fit the maskable safe circle, so its marks are about
  15% smaller than the run's. Only a three-row glyph keeps the run's mark
  size, and no three-row F tried here read as an F.
- At 16 px, the rows do not land on whole pixels, so plain marks turn grey.
  The grey and outline cells fade first, which leaves the F. A hand-drawn
  16 px file on a 3 px pitch would make the marks sharp.
- Bold F shapes on a four-wide grid were tried and dropped: more marks made
  each mark smaller, and the run's chunky feel went with it.

## Adopt one

Copy the chosen `marks/<id>-light.svg` over `ui/public/favicon.svg`, then run
`scripts/generate-icons.sh`. The tab icon variant needs a separate `<link
rel="icon">` if the tab and the PWA icons should differ.
