# Forgerie Design System (target)

Status: **draft target**, not yet implemented. This document defines the design
system Forgerie is moving toward. It is written from scratch, not derived from
the current UI. The current UI is measured against it in
`docs/design-audit.md`.

The bar is Linear: a surface where every screen has one obvious job, the
visual system is small enough to hold in your head, and interaction feels
immediate and quiet.

---

## 1. Principles

These are the rules that produce the quality bar. Everything below is an
instantiation of one of them.

### P1 — One job per surface

Every surface answers exactly one question. The inbox answers "what needs me".
The chat answers "what is this session doing". The workspace answers "what is
the state of the code". A surface that answers two questions is two surfaces.

### P2 — Restraint is the aesthetic

Quality comes from what is removed. One accent color. One shadow. One border
weight. One motion curve. Every new visual variable must displace an existing
one, not be added beside it.

### P3 — The system is finite and enumerable

Any value a designer or agent can choose comes from a closed set: 8 spacing
steps, 7 type steps, 4 radii, 3 elevations. If a value is not in the set, the
answer is not "add an inline value" — it is "the set is wrong, fix the set".

### P4 — Space decides layout, not device class

Components read the space they are given, not the viewport. There are no
device breakpoints. See §7.

### P5 — Keyboard is the primary input, touch is equal, mouse is incidental

Every action has a keyboard path. Every action has a touch target that meets
44px. Nothing is reachable only by hover.

### P6 — State is legible without motion

Status is readable from a still screenshot. Animation confirms a transition;
it never carries information on its own.

---

## 2. Token architecture

Today `THEME_TOKENS` covers color only (35 tokens). The target has four token
families. Only the **color** family varies by theme. Space, type, and form are
theme-invariant — a theme changes hue, never rhythm.

```
--fg-color-*    per-theme, swappable
--fg-space-*    invariant
--fg-text-*     invariant
--fg-form-*     invariant  (radius, border, elevation, motion)
```

Naming: `--fg-` prefix, family, role, modifier. `--fg-color-surface-raised`,
not `--pi-surface-hover`. The prefix change is deliberate — it makes migration
mechanical and greppable, and marks the fork's divergence from `--pi-`.

---

## 3. Space

One scale. Geometric-ish, 4px-rooted, fluid at the top end where layout
gutters live.

| Token | Value | Use |
|---|---|---|
| `--fg-space-0` | `0` | flush |
| `--fg-space-1` | `2px` | hairline offsets, icon nudges |
| `--fg-space-2` | `4px` | inside a chip, icon-to-label |
| `--fg-space-3` | `8px` | control padding, tight stack |
| `--fg-space-4` | `12px` | default gap between siblings |
| `--fg-space-5` | `16px` | block padding, list row inset |
| `--fg-space-6` | `clamp(16px, 2cqi, 24px)` | section separation |
| `--fg-space-7` | `clamp(24px, 4cqi, 40px)` | panel gutters |
| `--fg-space-8` | `clamp(40px, 8cqi, 72px)` | empty-state and page framing |

Rules:

- Steps 6–8 are container-fluid (`cqi`). Steps 0–5 are static: control-scale
  spacing should not breathe, or controls feel unstable during a fold.
- Do not use a value not in this table. `7px` and `11px` do not exist.
- Gaps come from the parent (`gap`), not from child margins.

## 4. Type

One family, seven steps, three weights. All steps container-fluid.

| Token | Size | Line | Weight | Use |
|---|---|---|---|---|
| `--fg-text-micro` | `clamp(10px, .68rem + .1cqi, 11px)` | 1.3 | 500 | counts, timestamps, badges |
| `--fg-text-meta` | `clamp(11px, .72rem + .1cqi, 12px)` | 1.4 | 450 | secondary row metadata |
| `--fg-text-body` | `clamp(13px, .84rem + .12cqi, 14px)` | 1.55 | 400 | list rows, controls, chat |
| `--fg-text-emphasis` | `clamp(13px, .84rem + .12cqi, 14px)` | 1.55 | 550 | selected row, active label |
| `--fg-text-title` | `clamp(15px, .95rem + .15cqi, 17px)` | 1.35 | 550 | panel and section titles |
| `--fg-text-display` | `clamp(20px, 1.2rem + .4cqi, 26px)` | 1.2 | 600 | empty states, onboarding |
| `--fg-text-code` | `clamp(12px, .78rem + .1cqi, 13px)` | 1.5 | 400 | diffs, terminal, inline code |

Rules:

- Weights: 400, 550, 600. No 700 in UI chrome; bold is for code emphasis only.
- Letter-spacing is a property of the step, not a per-site override. `micro`
  and `meta` carry `+0.01em`; `display` carries `-0.01em`. Nothing else sets it.
- Uppercase labels (`WORKING`, `OPEN`) use `--fg-text-micro` + `+0.06em`. That
  is the only uppercase treatment in the app.
- One UI family (system stack) and one mono family. No third family.

## 5. Color

Semantic roles only. A component never names a hue.

**Surfaces** — three depths, no more.

| Token | Meaning |
|---|---|
| `--fg-color-canvas` | the page behind everything |
| `--fg-color-surface` | panels, rows, cards |
| `--fg-color-surface-raised` | popovers, sheets, menus |

**Lines**

| Token | Meaning |
|---|---|
| `--fg-color-line` | structural dividers, panel edges |
| `--fg-color-line-soft` | in-list separators, low-contrast rules |

**Text** — four levels. If a fifth is wanted, the hierarchy is wrong.

`--fg-color-text` · `--fg-color-text-muted` · `--fg-color-text-faint` ·
`--fg-color-text-strong`

**Accent** — exactly one. Used for focus, selection, and the single primary
action per surface. If two things on screen are accent-colored, one of them is
wrong.

`--fg-color-accent` · `--fg-color-accent-contrast` · `--fg-color-accent-quiet`

**Status** — four, each with a text color and a quiet fill. Status colors never
carry meaning alone; they always accompany a word or icon.

`running` · `waiting` · `blocked` · `done`

Rules:

- Contrast floor: 4.5:1 for text, 3:1 for meaningful non-text.
- A theme supplies every token or is rejected at load. No partial themes, no
  silent fallback to another theme's hue.
- Light and dark are peers. Neither is derived from the other by inversion.

## 6. Form

**Radius** — four values.

| Token | Value | Use |
|---|---|---|
| `--fg-radius-sm` | `4px` | badges, inline chips |
| `--fg-radius-md` | `8px` | controls, inputs, rows |
| `--fg-radius-lg` | `14px` | sheets, panels, modals |
| `--fg-radius-pill` | `999px` | status pills, avatars |

**Border** — one weight, `1px`. Emphasis comes from color, never thickness.
The only exception is the focus ring.

**Elevation** — three levels, and elevation implies a surface token.

| Token | Use |
|---|---|
| `--fg-elevation-flat` | in-flow panels — no shadow, a line instead |
| `--fg-elevation-popover` | menus, tooltips, completions |
| `--fg-elevation-sheet` | drawers, modals |

**Focus** — one ring everywhere: `2px solid var(--fg-color-accent)` at
`2px` offset. Never removed, never restyled per component.

**Motion** — two durations, one curve.

| Token | Value | Use |
|---|---|---|
| `--fg-motion-quick` | `120ms` | state changes, hover, press |
| `--fg-motion-move` | `220ms` | position and size changes |
| `--fg-motion-ease` | `cubic-bezier(.2,0,0,1)` | everything |

All motion is wrapped in `prefers-reduced-motion`. Nothing animates on load.

## 7. Layout

**No viewport breakpoints.** This is the rule that makes the posture matrix
work. The shell already implements it — `panelIntent.ts` seats panels against
their own content minimums, cheapest first, after reserving
`SESSION_COMFORTABLE_WIDTH` for the transcript. Extend that model; do not
replace it. The work below is about pushing the same rule down into the
components.

- Every panel declares `container-type: inline-size` and styles itself from
  `@container` queries against its own width.
- The app shell is the single place allowed to read viewport size, and it does
  so continuously: panel widths are `clamp()`ed fractions, not stepped values.
- A panel that runs out of room becomes a sheet over the same content. It does
  not become a different component. The transition is a transform, and the
  panel keeps its scroll position, draft text, and open sub-panels across it.
- Lists and grids gain tracks with `repeat(auto-fit, minmax(…))`.
- Density is one variable, `--fg-density` (`comfortable` | `compact`), applied
  at the shell and consumed by row padding. It is a user preference, never
  inferred from screen size or pointer type.

Layout targets, expressed as intent rather than pixels:

| Available shell width | Navigation | Chat | Workspace |
|---|---|---|---|
| ample | resident | resident | resident |
| moderate | resident | resident | sheet |
| tight | sheet | resident | sheet |

The thresholds are properties of the panels' own minimum comfortable widths,
computed from the space scale — not device numbers.

### Acceptance range

The system must hold continuously across the full acceptance range, not at a
set of sampled points. Two devices define the ends of that range:

- **Galaxy Z Fold 8** — four postures, CSS viewports measured, spanning
  475 × 638 to 932 × 553. See `AGENTS.md`.
- **Tab Ultra 11** — 2960 × 1848 physical, 14.6-inch. CSS viewport and DPR
  are **not yet measured**. Do not derive them from the physical resolution.
  Record both orientations in `AGENTS.md` once measured on the real device.

The Tab widens the range by roughly 3× at the top end. Three consequences for
this system:

1. **Space steps 6–8 carry the load.** They are the only fluid steps, so they
   are what keeps a tablet-width panel from reading as a stretched phone
   panel. If a surface looks merely zoomed on the Tab, the fix is a fluid
   gutter or an added grid track — never a new breakpoint.
2. **`ample` becomes the common case, not the exception.** The three-panel
   resident layout in the table above is a Fold-landscape edge case today and
   the Tab's default tomorrow. Design it as the primary layout, and treat the
   sheet layouts as the reductions.
3. **Grids must add tracks.** `repeat(auto-fit, minmax(…))` is not optional at
   Tab width. A fixed column count that merely grows its columns is the
   failure mode this device exposes.

Density (§7) matters more here: a 14.6-inch surface at `comfortable` wastes
space that a keyboard-first user wants back. This is an argument for making
`--fg-density` a real, surfaced user preference rather than a hidden token.

No Tab Ultra 11 validation is possible until its CSS viewport is measured.
Until then, judge tablet-width behavior by resizing a desktop browser
container — and label that as unverified, not as device validation.

## 8. Component contract

Every UI unit in Forgerie must satisfy all of these before it is considered
done:

1. Uses only tokens from §3–§6. Any raw value carries an adjacent comment
   naming the missing token.
2. Declares its own container and responds to it. Reads no viewport unit.
3. Has a visible focus state driven by the shared focus ring.
4. Has a keyboard path to every action it exposes.
5. Renders every state it can be in — loading, empty, error, ready — from a
   tagged union, not from boolean flags.
6. Survives a fold, unfold, and rotation with its scroll position, draft text,
   and open sub-state intact.
7. Meets 44px minimum interactive size at `comfortable` density.

## 9. Enforcement

A design system that is only a document decays. Three mechanical gates:

- **Lint**: reject raw `px` in component styles outside a token allowlist
  (`0`, `1px`, `100%`-likes). Reject `@media (min-width|max-width)` in
  component files entirely; only the shell may use them, and only for the page
  frame.
- **Token completeness**: a theme missing any `--fg-color-*` token fails at
  load with a named error, not a fallback.
- **Posture capture**: the four posture screenshots are produced on every
  user-facing change and reviewed, per `AGENTS.md`.

## 10. Open questions

Decisions this draft does not make, and should not make alone:

1. **Migration shape.** Big-bang `--pi-` → `--fg-` rewrite, or dual-token
   period where `--pi-*` aliases the new tokens? Cost of the alias period is a
   long window where both systems are live.
2. **Default theme.** The shipped default is `pi-web-dark` (purple/cyan), but
   the running instance renders cream. That mismatch must be resolved before
   any color work, or the target palette is being judged against the wrong
   baseline.
3. **Density default.** `comfortable` or `compact` out of the box, given the
   acceptance device is a phone-sized surface much of the time.
4. **Type family.** System stack, or ship a variable font? Linear's texture
   comes partly from a bespoke face; a system stack caps how close the result
   gets.
