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

## Slice 2 — Scales (done 2026-08-16, ae07446)

- [x] Fluid 4-step type ramp (`--pi-text-xs/sm/md/lg`); swept simple
      `font-size`/`font:` declarations in 41 files. Display glyph sizes
      (20–25px) and the inbox's local clamps remain — harmonize in Slices 6–7
- [x] Named fluid space tokens defined; adopted on settings cards. Broad
      padding sweep continues per-surface in Slice 7
- [x] Radius scale (`inline 4 / control 8 / surface 12 / pill`); swept all
      nine ad-hoc radii; deliberate literals remain (0, 50%, 2–3px).
      Absorbed parked item 01KZRYRH8AP4HCQA18H4S3NMRV ◆
- [x] Tabular numerals verified in monospace surfaces (inherited
      font-variant-numeric; ui-monospace is fixed-pitch)

## Slice 3 — Color semantics (done 2026-08-16, 29dda01)

- [x] Status-color audit: count badges neutralized, skill disclosures to
      accent; status uses kept (working/unread, pulses, shell mode, machine
      health, process outcomes, tree kind tones) ◆
- [x] One 2px accent focus ring; field focus keeps border+ring convention
- [x] WCAG AA audit script passes both palettes; light muted/dim darkened one
      step (were 4.48:1 / 2.98:1)
- [x] Terminal chrome reads live tokens (verified); ANSI 16-color palette
      stays pinned deliberately for content fidelity; stale fallbacks aligned
- [x] Classic theme untouched as legacy fallback; full suite green

## Slice 4 — Copy & metadata (done 2026-08-16, eef7124)

- [x] Transcript meta: provider route dropped, model ids humanized,
      distance-proportional timestamps, "high effort" labeling ◆
- [x] Composer placeholder one quiet line; sigil menus teach themselves ◆
- [x] Inbox header shows the grouping value directly; sr text keeps the
      full phrasing ◆
- [x] Usage meters re-scoped: rendered by the profile extension
      multi-account-usage.ts, outside this repo/release → backlog
      01M06SX5MWA4NH0G8T2X863JNJ ◆

## Slice 5 — Posture & intrinsic defects (done 2026-08-16, 9df02e9)

- [x] RETRACTED: the "clipped controls at 475px" and "dead band in folded
      landscape" defects were capture artifacts — headless chromium
      --window-size is not the viewport (width clamps ~500px; height budget
      differs). CDP measurement at true metrics shows the opener inside the
      viewport (right 471 < 475) and the composer at its designed 8px margin
- [x] Capture methodology fixed: scripts/capture-postures.mjs gains
      --color-scheme (emulated prefers-color-scheme); AGENTS.md recipe
      replaced and the raw --window-size pitfall documented
- [x] Width-breakpoint audit: zero width media queries in the client; only
      capability/preference queries (verified by grep)
- [ ] User on-device acceptance: Z Fold 8 full posture matrix, both modes
      (open — the one remaining gate for slices 0–5)

## Slice 6 — Inbox refinement (done 2026-08-16, 6590e02)

- [x] Row anatomy: working-row clock glyph removed (pulsing marker carries
      the state); time column tabular and baseline-aligned; unread preview
      already clean 2-line clamp — the mid-word fade was the retired
      pre-slice-0 styling ◆
- [x] Group headers reviewed under color semantics: state tones stay
      (working/unread/blocked are statuses); project grouping stays neutral
- [x] Slice-2 residual: inbox local type clamps harmonized onto the ramp;
      stale fallback hexes updated; scrollbar inherits the root style

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
