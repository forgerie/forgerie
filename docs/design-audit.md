# Design audit — pre-polish UI vs target system (historical)

Status: **superseded 2026-08**. These findings drove the ui-polish program
(`work/items/active/01M013K7Q4VXN2R8TJ5W9EBHCD-ui-polish-design-language/`),
which addressed them across nine slices; `docs/design-system.md` now
describes the as-built system. Kept as history of the starting point.

Measured against the earlier draft-target version of
`docs/design-system.md`.

**Headline: Forgerie has a color theme, not a design system.** Tokens cover
color only. Spacing, type, and form are open-coded across ~2,000 raw values,
with no gate preventing more. Layout architecture is sound and is not the
problem.

All figures below are counted, not estimated.

Method:

- Source counts via `grep` over `src/client/src`.
- Screenshots captured headless at the four `AGENTS.md` posture viewports
  against the running instance on `127.0.0.1:8504`, then reviewed.

## Posture captures

| Posture | Viewport | Result |
|---|---|---|
| Unfolded landscape | 932 × 553 | Navigation docked. Grouped sessions (`WORKING 3`, `OPEN 22`, `ARCHIVED 124`) beside an empty chat pane. |
| Unfolded portrait | 704 × 783 | Navigation undocked. Empty canvas, one toggle icon top-right. |
| Folded portrait | 475 × 638 | Navigation undocked. Toggle icon clipped by the right viewport edge. |
| Folded landscape | 711 × 374 | Navigation undocked. |

### This is not a breakpoint defect

An earlier draft of this audit read the three undocked postures as a worse
version of the breakpoint cliff noted in `AGENTS.md`. That reading was wrong
and is withdrawn.

The shell derives docking from panel content minimums, not device widths
(`src/client/src/appShell/panelIntent.ts`,
`src/client/src/appShell/shellLayoutMode.ts`):

| Constant | Value |
|---|---|
| `NAVIGATION_PANEL_MIN_WIDTH` | 260 |
| `SESSION_COMFORTABLE_WIDTH` | 560 |
| `NAVIGATION_DOCK_MIN_WIDTH` | 820 |

`dockedPanels()` subtracts the session's comfortable measure from available
width, then seats panels cheapest-first against their own minimums. At 932px
navigation fits beside a readable transcript and docks. Below 820px it stays
reachable as an overlay rather than squeezing the transcript.

That is the rule `docs/design-system.md` §7 proposes as a target. The shell
already implements it. The redesign should extend this model, not replace it.

### Real defects from the captures

1. The panel toggle icon is clipped by the right viewport edge at 475px.
2. At first paint below 820px there is no visible affordance that a session
   list exists. This is a discoverability question for the redesign, not a
   layout bug.

## System-level gaps

| Target section | Current state | Gap |
|---|---|---|
| §2 Token architecture | 35 tokens, all color (`THEME_TOKENS` in `src/client/src/theme.ts`) | No space, type, or form tokens exist. |
| §3 Space | 1,993 raw `px` literals in `src/client/src` | No scale. Most common: `1px` (232), `8px` (220), `12px` (148), `6px` (108), `2px` (93), `10px` (89). |
| §4 Type | 20+ distinct `font-size` values; `12px` (57), `11px` (33), `13px` (11); includes `11.5px` | No ramp. Only 31 `clamp()` uses repo-wide, of which 22 are font sizes. |
| §5 Color | Semantic-ish already (`--pi-surface`, `--pi-muted`) | Closest area to target. Roles are inconsistent (`--pi-text-secondary` and `--pi-muted` share a value in `pi-web-dark`). |
| §6 Form | 15 distinct `border-radius` values (`2,4,5,6,7,8,9,10,12,14px`, `50%`, `999px`) | No radius scale. Four shadow tokens exist but no elevation model. |
| §7 Layout | 43 container-query references; shell docking derived from content minimums | Closest area to target. Largely already satisfied. |
| §9 Enforcement | None | No lint gate on raw values or media queries. |

## Concentration risk

Styles are inline in very large component files, which is why 2,000 raw values
accumulated without anyone noticing:

| File | Lines |
|---|---|
| `src/client/src/components/PiWebApp.ts` | 3,619 |
| `src/client/src/components/ChatView.ts` | 1,749 |
| `src/client/src/components/SessionInboxPanel.ts` | 1,670 |
| `src/client/src/components/PromptEditor.ts` | 1,553 |

## Theme resolution (investigated, no defect)

An earlier draft of this audit reported a mismatch between the shipped default
theme and the rendered surface. That report was wrong and is withdrawn.

`DEFAULT_THEME_PREFERENCE` is `{ themeId: "pi-web-dark", auto: true }`. With
`auto` set, `resolveThemePreference` resolves through the `themes:pi-web`
pair and selects `pi-web-light` when the client prefers light. `pi-web-light`
sets `--pi-bg: #f7f1e6` — the cream surface seen in the captures. The behavior
is correct.

Note for future capture work: headless Chromium reports
`prefers-color-scheme: light` by default. Posture captures therefore exercise
the light theme unless the dark scheme is forced. Both themes need capture
coverage.
