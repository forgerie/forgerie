# Tally logo candidates

Three logo candidates drawn from the tally marks in the chat margin
(`ui/src/ui/TallyRow.css`). They do not replace `ui/public/favicon.svg` yet.

Every candidate uses the tally geometry: a mark is 7 units square, the gap is
3 units, the corner radius is a quarter of the mark, and a row holds three
marks. The failure and live colours are the app's `--tone-bad` and
`--tone-live`, converted from oklch to hex.

| Candidate | Idea |
| --- | --- |
| Tally F | The F spelled on a 3 × 5 tally grid. The last mark is red and falls into place, as in the current mark. |
| Rail F | The turn rail is the spine. Two tally rows are the arms. The last mark is the live blue. |
| The run | No letter. Eight marks wrapped and right-aligned as the chat draws them: one red, one live. |

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

- At 16 px, Tally F breaks into grey dots. Its gaps are 3/7 of a mark, too
  wide for a letter made of separate cells.
- Rail F lands on whole pixels at 16 px and stays readable.
- The run reads at every size but has no letter, so it depends on the name
  beside it.

## Adopt one

Copy the chosen `marks/<id>-light.svg` over `ui/public/favicon.svg`, then run
`scripts/generate-icons.sh`. The tab icon variant needs a separate `<link
rel="icon">` if the tab and the PWA icons should differ.
