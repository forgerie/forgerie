# Plan — UI polish, calm instrument panel

Each slice ships alone and keeps the app deployable. Per-slice ritual:
`npm run verify` → capture 2 modes x 4 postures → read the captures →
`npm run build` + restart `forgerie-web.service` (never sessiond with
sessions mid-run) → atomic commit.

Items marked ◆ were verified defects in the direction session's captures or
code reading. Others are anticipated; audits may resize them.

## Design language (the contract every slice serves)

- One neutral lightness ramp per mode: bg → surface → surface-hover.
  Dark `#111214/#191a1d/#202225`; light `#fafaf8/#ffffff/#f1f1ee`.
- Separation by surface step and shadow; borders are hairlines, last resort.
- One accent (cobalt `#6699e0` dark / `#3563c4` light) for selection,
  focus, and the primary action only.
- Status hues desaturated; they appear only when something has a status.
- Tabular numerals wherever a number lives.
- Chrome hierarchy: one filled primary control per surface; secondary
  controls are ghosts; input-like controls keep a quiet border.
- Intrinsic: fluid clamp()/cqi scales, container queries, no new width
  breakpoints (475–932px range is sacred), static values only for things
  that must not scale (radii).

## Slice 0 — Land the direction (done 2026-08-16, d5959c8)

- [x] Calm graphite dark + paper light token sets (`plugins/themes/index.ts`)
- [x] Tabular numerals globally (`index.html`)
- [x] Composer ghost chrome + filled send + archive fix (`shared.ts`)
- [x] Ghost the guidance-trigger (star) border holdout ◆
- [x] Favicon `#00f0d8` neon, apple-touch-icon, manifest colors, meta
      theme-color `#0d1117` → new palette ◆
- [x] `index.html` `:root` fallback palette → match new dark (pre-theme flash) ◆
- [x] `npm run verify` (only the parked defaults-test flake); commit; deployed

## Slice 1 — Elevation sweep (done 2026-08-16, 53be76a)

- [x] Demote major bordered constructs (settings cards, inbox header chrome,
      undo toast, composer draft edge); remaining per-surface demotions fold
      into Slice 7
- [x] Settings dialog: flatten box nesting; config-path card becomes a
      labeled readout; primary buttons filled accent (fixed nonexistent
      --pi-accent-contrast reference) ◆
- [x] Overlay/popover shadows verified consistent with the new visible
      dark shadow tokens
- [x] Thin palette-tinted scrollbars via inherited scrollbar-color ◆

## Slice 2 — Scales (intrinsic)

- [ ] Fluid 4-step type ramp (clamp/cqi tokens); sweep ad-hoc 10–16px sizes
- [ ] Named fluid space tokens; sweep ad-hoc 4–14px paddings
- [ ] Two-tier static radius system + pill; sweep 2/4/5/6/7/14px outliers ◆
- [ ] Verify tabular numerals hold in shadow-DOM monospace surfaces

## Slice 3 — Color semantics

- [ ] Status-color audit: WORKING/UNREAD headers, dots, badges ◆
- [ ] One accent focus ring everywhere
- [ ] WCAG AA contrast pass over both canvases
- [ ] Align DEFAULT_TERMINAL_ANSI_THEME + terminal selection with palette
- [ ] Classic theme: keep as legacy contribution; verify fallback path renders

## Slice 4 — Copy & metadata

- [ ] Transcript meta: humanize model names, label effort, short timestamps ◆
- [ ] Composer placeholder: one short line; sigil lesson → progressive help ◆
- [ ] Inbox header: fix "Grouped by Sta…" truncation; rationalize controls ◆
- [ ] Usage meters: label or redesign into a legible quota affordance ◆

## Slice 5 — Posture & intrinsic defects

- [ ] Clipped panel toggle + settings ✕ at 475px (container sizing) ◆
- [ ] Dead band below composer in folded landscape ◆
- [ ] Audit for width breakpoints near 475–932px
- [ ] User on-device acceptance: Z Fold 8 full posture matrix, both modes

## Slice 6 — Inbox refinement

- [ ] Row anatomy: drop per-row clock glyphs, aligned time column, clean
      unread-preview truncation ◆
- [ ] Group-header hierarchy under the single-accent rule

## Slice 7 — Remaining surfaces

- [ ] Files, Git, Terminal panels; Project/Machine/Cleanup/Auth dialogs;
      command palette/picker; ask-user + extension cards; process cards
- [ ] Empty state: useful first screen (projects/recent sessions + brand) ◆

## Slice 8 — Motion

- [ ] 2–3 intentional transitions (panel slide, composer state, list settle)
- [ ] prefers-reduced-motion respected

## Slice 9 — Codify

- [ ] Durable design-language doc (tokens, ramps, elevation, color semantics,
      chrome rules) under docs/
- [ ] Token contract cleanup: add missing tiers (focus ring, elevation),
      remove dead duplicates, document for plugin themes
