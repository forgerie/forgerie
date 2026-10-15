# Decision hints: interface verification

Checked on 2026-10-14. What the user sees is in `docs/decision-hints.md`, "What you see".

## How the screenshots were made

In-situ screens come from `ui/verification/decision-hints.html`, which renders the production
components (AppShell, Picker, Thread, PinnedDock, GatedActionCard, PluginsView) on fixture data,
with no network. Start the browser app's dev server, then capture the four Fold 8 postures:

```sh
npm --prefix ui run dev -- --port 8611 --host 127.0.0.1
CHROME_BIN=<chromium> node scripts/capture-postures.mjs \
  --url "http://127.0.0.1:8611/verification/decision-hints.html?scenario=picker" \
  --out ui/verification/decision-hints --label picker-light --color-scheme light --settle 2000
```

Scenarios: `picker`, `picker-off`, `picker-narrow` (the docked list at its 15rem floor), `gate`,
`gate-off`, `gate-arrives` (the label arrives 2 s after the card), `bash`, `bash-open`, `bash-off`,
`settings-present`, `settings-missing`, `settings-unknown`. `-off` drops all hint and label data.

The gate card's levels are Caliper part states (`src/gatedActions/GatedActionCard.organism.part.tsx`),
rendered with `caliper-render --device '*'` at one image pixel per CSS pixel.

## Screenshots

All in `ui/verification/decision-hints/`. Postures: `unfolded-portrait` 704 × 783,
`unfolded-landscape` 932 × 553, `folded-portrait` 475 × 638, `folded-landscape` 711 × 374.

| Surface | Files |
| --- | --- |
| Picker with hints | `picker-light-*.png` (4 postures), `picker-dark-folded-portrait.png`, `picker-dark-unfolded-landscape.png` |
| Picker without hints | `picker-off-light-*.png` (4 postures) |
| Picker at 15rem | `picker-narrow-light-folded-portrait.png` |
| Gate card, each level, in-card | `parts/gate-card-RiskLow-*.png`, `parts/gate-card-RiskCheck-*.png`, `parts/gate-card-RiskDanger-*.png` (5 devices each) |
| Gate card without a label | `parts/gate-card-NoLabel-*.png`, `gate-off-light-*.png` |
| Gate card decided, label kept | `parts/gate-card-RefusedWithRisk-*.png` |
| Gate card pinned, danger | `gate-light-*.png`, `gate-dark-folded-portrait.png`, `gate-dark-unfolded-landscape.png` |
| Late label, before and after | `gate-arrives-before-light-*.png`, `gate-arrives-after-light-*.png` |
| Bash lines with labels | `bash-light-*.png`, `bash-open-dark-folded-portrait.png`, `bash-open-dark-unfolded-landscape.png` |
| Bash lines without labels | `bash-off-light-folded-portrait.png` |
| Settings, key present | `settings-present-light-*.png` |
| Settings, key missing | `settings-missing-light-*.png`, `settings-missing-dark-folded-portrait.png`, `settings-missing-dark-unfolded-landscape.png` |

## Findings

- The late label does not move the choices. In all four postures, Refuse and Approve and run are
  at the same pixel row before and after (`gate-arrives-*`). Tall panes: the pinned list grows
  upward. Short panes: the choices sit beside the title and the label follows them.
- At 15rem the location and the hint word both shrink to an ellipsis; nothing wraps or overflows.
- Caliper `--check`: RiskBadge (5 states) and GuessTag (3 states) pass render, browser, spill,
  accessibility and determinism on all 5 devices. Baselines were not run (no baseline folder).
- Findings that are the same in existing states at base, not caused by this work: the Picker part
  fails axe `aria-required-children` on `.picker-list` (also in its `default` state); pinned gate
  states report axe `color-contrast` as incomplete on the title over the dock's scroll shade (also in
  `PinnedLongCommand`); the long-command card spills in folded landscape (also in `MessageInYourName`).
  In the Caliper frame the pinned states do not switch to the short-pane layout, because the frame
  has no block-size container; the in-situ captures show that layout.

## Not verified

- The scroll compensation for a label that arrives on an open gate card inside a scrolling thread.
  The in-situ check covers the pinned list only. A waiting gate is pinned (`ForgerieSession.tsx`),
  so an open card in the thread is rare.
- Screen-reader output on a device. Accessible text is asserted in tests, not heard.
- Physical-device acceptance. Captures are emulated geometry.
