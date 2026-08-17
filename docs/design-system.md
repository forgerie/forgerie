# Forgerie Design Language

Status: **as built**. This document describes the design system the client
actually ships, established by the 2026-08 polish program
(`work/items/active/01M013K7Q4VXN2R8TJ5W9EBHCD-ui-polish-design-language/`).
An earlier draft of this file described an aspirational target system with a
`--fg-` token rename; the program kept the `--pi-` contract and a smaller
closed set instead. `docs/design-audit.md` records the pre-program findings
and is retained as history.

The bar is a calm instrument panel: content is the brightest thing on screen,
chrome recedes until touched, and every value comes from a small enumerable
set.

---

## 1. Principles

**One accent.** Cobalt speaks for focus, selection, and the single filled
primary action per surface — nothing else. If two things on one surface are
accent-filled, one of them is wrong.

**Color is semantics, not decoration.** Status hues (success, warning,
danger, purple) appear only where the thing they name is true, always beside
a word or glyph, never as ornament. Counts are information, not success:
badges stay neutral.

**Separation comes from the surface ramp, borders last.** Depth is shown by
background steps first, hairlines second, full borders only for controls,
and shadow only for true overlays.

**Ghost chrome by default.** Wayfinding controls (tabs, header actions,
openers) are transparent at rest, gain a surface on hover, and use the
selection fill as their one filled state. Bordered boxes are reserved for
controls that take input.

**The set is closed.** Type, space, radius, and motion values come from the
scales below. If a needed value is missing, fix the scale — do not inline a
literal.

**Intrinsic, not adaptive.** Components read their container (`cqi`,
container queries), never the viewport. The client contains zero width media
queries; only capability and preference queries (`hover`, `pointer`,
`prefers-*`, `display-mode`) exist. The Z Fold 8 posture range (475–932 px
CSS width) is the reference envelope.

**State is legible without motion.** Animation confirms a transition; it
never carries information alone, and every movement respects
`prefers-reduced-motion`.

---

## 2. Token contract

Defined once in `src/client/index.html` (`:root`). Only **color** is
themeable: plugin themes supply the tokens listed in `THEME_TOKENS`
(`src/client/src/theme.ts`) and nothing else. Geometry — type, space,
radius, motion, focus ring — is the app's own and does not vary by theme.

### Color (themeable, per `THEME_TOKENS`)

Surface ramp `--pi-bg` → `--pi-surface` → `--pi-surface-hover`; lines
`--pi-border` (controls) and `--pi-border-muted` (hairline structure); text
levels `--pi-text-bright` / `--pi-text` / `--pi-text-secondary` /
`--pi-muted` / `--pi-dim`; one accent (`--pi-accent`, `--pi-accent-border`,
`--pi-selection-bg`); status families (`success`, `warning`, `danger`,
`purple`) with their border/surface variants; overlay and shadow tiers;
terminal pair (`--pi-terminal-bg`, `--pi-terminal-text`).

The default pair is Forgerie Dark (graphite `#111214/#191a1d/#202225`,
cobalt `#6699e0`) and Forgerie Light (paper `#fafaf8/#ffffff`, cobalt
`#3563c4`), resolved by `prefers-color-scheme` when the preference is auto.
The `:root` fallback block in `index.html` mirrors Forgerie Dark so the
pre-theme flash matches; keep the two in sync.

Contrast floor: WCAG AA — 4.5:1 for text (including `--pi-muted` and
`--pi-dim` on every surface they sit on), 3:1 for meaningful non-text.

Filled primaries pair `background: var(--pi-accent)` with
`color: var(--pi-bg)`. There is no separate contrast token.

The terminal's ANSI-16 palette is deliberately pinned, not themed: terminal
content is content, and its colors are part of what programs print. Terminal
*chrome* reads live tokens.

### Type (fluid, 4 steps + constants)

| Token | Size | Use |
|---|---|---|
| `--pi-text-xs` | 11→12 px | counts, badges, timestamps |
| `--pi-text-sm` | 12→13 px | metadata, chips, group labels, code |
| `--pi-text-md` | 14→15 px | body, list titles, controls' labels |
| `--pi-text-lg` | 17→18 px | panel titles, headlines |

`font-variant-numeric: tabular-nums` wherever a number lives. Focused form
controls stay at `--pi-control-font-size: 16px` static — mobile browsers
zoom inputs below 16 px. Uppercase is reserved for group/section labels at
`sm` weight 650 with `0.04–0.08em` tracking.

### Space (fluid, 4 steps)

`--pi-space-xs` (4) · `--pi-space-sm` (6→8) · `--pi-space-md` (10→12) ·
`--pi-space-lg` (14→18). Larger gutters compose these or use scoped
`clamp()` with `cqi`/`cqb` terms; control-scale spacing does not breathe.

### Radius (static, 3 tiers + pill)

`--pi-radius-inline` (4) · `--pi-radius-control` (8) ·
`--pi-radius-surface` (12) · `--pi-radius-pill` (999). Static on purpose: a
corner that scales with its container reads as a rendering bug, not fluid
design.

### Motion (2 speeds)

`--pi-motion-fast` (120 ms) for micro feedback — hover, fades, color.
`--pi-motion-move` (180 ms) for structural travel — panel slides, drawers,
toasts, overlays. Ambient status pulses (1–1.8 s) sit deliberately off the
scale. Every entrance or translate animation carries a
`prefers-reduced-motion: reduce` guard.

### Focus

`--pi-focus-ring: 2px solid var(--pi-accent)` — one ring for the whole app.
Use `outline: var(--pi-focus-ring, 2px solid var(--pi-accent))` so shadow
DOM styles keep a working fallback.

---

## 3. Component grammar

**Tabs and tool strips** (workspace tools, terminal shells, mobile main
tabs): ghost buttons; hover = `--pi-surface`; the selected tab is the one
filled state (`--pi-selection-bg`), no border, no accent outline.

**Buttons**: one filled accent primary per surface; secondary actions are
bordered-neutral inside dialogs and ghosts inside panels. Danger stays
text-`--pi-danger` with a quiet danger fill on hover.

**Dialogs**: `--pi-radius-surface` shell, hairline header/footer
separators, control-bordered inputs, status cards keep their semantic
borders.

**Lists** (inbox, files, git): separation by hairline or hover surface, not
boxes; selected row = selection fill + 2 px accent inset bar; state markers
are 7 px dots with tone colors; the time column is tabular and
baseline-aligned; no per-row glyph columns.

**Empty states**: a composed first screen, not an apology — brand mark,
contextual message, one filled primary, and useful content (recent
sessions) when it exists.

**Scrollbars**: inherit the document-root `scrollbar-color`; no per-panel
overrides.

---

## 4. Verification ritual

Every visual slice: `npm run verify` → capture the Fold 8 posture matrix in
both schemes with `node scripts/capture-postures.mjs` (never raw
`chromium --window-size`; see AGENTS.md for why) → read and judge the
captures → build, deploy, commit atomically with a changeset when
user-visible.
