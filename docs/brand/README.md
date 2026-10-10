# Brand assets

Forgerie's mark is eight tally marks from the chat margin on a 3 × 3 grid.
The five plain marks make an F. One red (failed) and two blue (live) marks
sit at the edge of the block, outside the F. The bottom-left cell is empty.

`scripts/generate-icons.mjs` is the only source of the mark. It writes every
file below and the iOS launch-screen links in `ui/index.html`. Change the
script and run it again; do not edit the generated files by hand.

```bash
./scripts/generate-icons.mjs
```

The script needs Nix (it pulls in resvg, ImageMagick, oxipng, and Chromium)
and an installed `ui/node_modules` for the Public Sans font.

## Two drawings

| Drawing | Geometry | Used for |
| --- | --- | --- |
| Large | The tally's own: 7-unit marks, 3-unit gaps, corner radius a quarter of the mark | App icons, launch screens, social cards, these SVGs |
| Small | A 16 px grid: 4 px marks, 1 px gaps, 1 px margin | Tab icon, `favicon.ico`, the in-app `LogoMark` |

The small drawing puts every edge on a whole pixel at 16, 32 and 48 px.

## Colours

| Role | Light | Dark |
| --- | --- | --- |
| Paper | `#fcfcfc` | `#101011` |
| Ink (the F) | `#232323` | `#ececea` |
| Red (`--tone-bad`) | `#de3b3d` | `#ff645f` |
| Blue (`--tone-live`) | `#2b7fff` | `#4c93ff` |

Installed-app icons and launch screens use the dark set, because an
installed app shows one icon and one launch colour.

## Files

In `ui/public/`, served with the app:

| File | Size | Purpose |
| --- | --- | --- |
| `favicon.svg` | vector | Tab icon; follows the system light or dark theme |
| `favicon.ico` | 16, 32, 48 | Older browsers and `/favicon.ico` requests |
| `icon-192.png`, `icon-512.png` | 192, 512 | Manifest `any`; draws its own rounded tile |
| `icon-maskable-192.png`, `icon-maskable-512.png` | 192, 512 | Manifest `maskable`; full bleed, mark inside the 80% safe circle |
| `icon-monochrome-512.png` | 512 | Manifest `monochrome`; white on transparent |
| `apple-touch-icon.png` | 180 | iOS home screen; opaque square |
| `safari-pinned-tab.svg` | vector | Safari pinned tab; one colour |
| `social-card.png` | 1200 × 630 | `og:image` link preview |
| `splash/apple-splash-*.png` | 42 files | iOS launch screens, one per device size and orientation |

In `docs/brand/`, for docs and the repository:

| File | Purpose |
| --- | --- |
| `mark-on-light.svg`, `mark-on-dark.svg` | The mark alone, no background |
| `icon.svg`, `icon-maskable.svg` | Vector masters of the app icons, 1024 px |
| `social-card-1200x630.png` | Link preview |
| `social-card-1280x640.png` | GitHub repository social preview |

The GitHub social preview is set by hand in the repository settings.

## Checks

`ui/src/buildContents.test.ts` builds the app and checks that every icon
the manifest and `ui/index.html` name ships at the size it states.
`ui/verification/brand-icons-sheet.sh` writes a review sheet with each icon
on light and dark grounds, circle and rounded-square crops, and the tab icon
enlarged.

The design history is in `prototypes/logo-tally/`.
