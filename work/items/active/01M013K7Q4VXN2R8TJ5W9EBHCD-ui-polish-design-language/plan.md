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

### 7a — Panel/dialog/card chrome (done 2026-08-16, 1e76fe2 + 428e703)

- [x] Workspace tool strip, terminal shell tabs, mobile main tabs → ghost
      chrome; selection is the one filled state (judged in true-viewport
      captures, both modes)
- [x] Panel header actions (Upload/Refresh/List/Tree/Select/Keys) → ghosts
- [x] Dialog framing (Machine/Project/Auth/Cleanup) → hairlines; controls
      keep borders; status cards keep semantic borders
- [x] Filled primaries unified on accent-on-bg text; undefined
      --pi-accent-contrast removed (white fallback failed AA on dark accent)
- [x] WorkspaceManagementDialog, AppPanelOpener, AppRadialMenu: last
      off-ramp clamps and retired-palette hexes swept
- [x] Palette/pickers/cards audited: already on-language (accent =
      focus/selection/primary only)
- [x] Tooling: capture script walks click paths (route params cannot reach
      tool panels once a session resolves)
- Residual for later: faint stray vertical hairline at the left edge of the
  empty viewer region in Files/Git panels (pre-existing; visible both modes)

### 7b — First screen (done 2026-08-16, 0671a70)

- [x] Empty session view → composed first screen: brand bar + wordmark,
      contextual message, one filled New-session primary, Recent list of the
      last five conversations (project · age meta via the inbox's resolver
      and formatter; archived/agent-spawned excluded)
- [x] Intrinsic: column caps at 30rem, rows ellipsize; judged in
      true-viewport captures, both schemes, folded and unfolded

- [ ] Files, Git, Terminal panels; Project/Machine/Cleanup/Auth dialogs;
      command palette/picker; ask-user + extension cards; process cards
- [ ] Empty state: useful first screen (projects/recent sessions + brand) ◆

## Slice 8 — Motion (done 2026-08-16, fa81493)

- [x] Two-token motion scale in index.html: --pi-motion-fast (120ms micro
      feedback), --pi-motion-move (180ms structural travel); seven scattered
      durations across ten files normalized onto it
- [x] Ambient status pulses (1s–1.8s) deliberately off the scale
- [x] Reduced-motion audit: guarded the inbox drawer/undo-toast slides, the
      machine-switcher pulse, and shared activity indicators; radial menu,
      shell panels, liveness dot, inbox marker were already guarded
- [x] THEME_TOKENS note extended: motion is geometry, not palette

### Original scope

- [ ] 2–3 intentional transitions (panel slide, composer state, list settle)
- [ ] prefers-reduced-motion respected

## Slice 11 — TUI parity for the session tree (done 2026-08-17)

User asked for parity with the Pi TUI's tree (`tree-selector.ts` in
pi-coding-agent 0.84.0). Gap analysis found ten differences; a, b and c
were taken, d and e deferred.

- [x] **11a reading lenses** (4c2397a): five filters (User / No tools /
      Conversation / Labeled / All). Opens on **User** — a deliberate
      divergence from the TUI's conversation default, at the user's
      request: a user message is the only entry whose text returns to the
      composer. Bookkeeping leaves the conversation lenses; tool-call-only
      assistant turns hide everywhere but as the active leaf (shared
      literal SESSION_TREE_TOOL_CALL_SUMMARY_PREFIX rather than sniffing
      server prose). Filtering re-parents survivors onto the nearest
      retained ancestor and recomputes branch depth, so no lens drifts the
      tree rightward. Position counter; empty-lens copy distinct from
      empty-session copy. Selection follows an **anchor**: narrowing
      repairs upward, widening returns to the anchor.
- [x] **11b search, copy, branch order** (3d3a79d): every-term search over
      label/kind/text; copy acts on the selection from the control row (no
      per-row chrome); at a fork the active branch sorts before abandoned
      siblings.
- [x] **11c branch rails** (eb30f3f): per-lane hairlines with elbows,
      ancestor lanes drawn only while their fork still has rows below.
      Folded entries keep a caret — closes the slice 10 residual.

Deferred (need server work, quoted to the user):
- 11d tool-call detail (`[read: ~/foo.ts:1-20]`): the projection drops
  tool arguments, so `SessionTreeNode` needs a new field.
- 11e label editing + label-timestamp toggle: no label-write endpoint
  exists.

Capture note: `/tree` needs a live session, and every idle session's
composer was disabled ("no model") during this slice, so captures used
`/tmp/forgerie-v2/capture-tree-fixture.mjs`, which mounts the real
component against a synthetic history containing a fork, labels,
bookkeeping and tool entries. Richer than any live session available.

Defect caught in capture, not tests: rows without rails lost a grid
column and overlapped kind with summary. The lane track is now always
emitted.

## Slice 10 — Session-tree navigator deep clean (done 2026-08-17, 9e87e4f)

User-requested follow-up: the /tree dialog predated the language. Restyle
in place, no interaction changes:

- [x] Per-row "Active path"/"Active leaf" word badges → structural accent
      dot column + leaf ring (legend now matches rows; sr-only text keeps
      the path audible)
- [x] Raw ISO timestamps → inbox relativeTime, tabular, dim, right column
- [x] Six colored kind chips → quiet muted text labels (kind-tone-*
      classes kept as semantic hooks only); accent wash over the active
      path removed — color now only in the marker column and selection
- [x] Disclosure carets only at true branch points; linear histories drop
      the column (a linear chain is all single-child nodes — first pass
      wrongly keyed on childIds > 0 and changed nothing; > 1 is the fix)
- [x] Bookkeeping rows compress to 36px/sm; tree list is the single
      scroller inside a hairline-framed surface (no more rows sliding
      unframed under the toolbar); header/footer/cards → hairlines; h1
      joins the type ramp; step-2 selected-entry preview clamps to 4 lines
- [x] Captured via one-off CDP driver (/tmp/forgerie-v2/capture-tree.mjs):
      /tree is composer-command-only, so the posture script's click paths
      can't reach it; driver types /tree, Escapes the slash autocomplete
      (which otherwise eats Enter → /relay-worktree), clicks Send, and can
      click Next for the confirmation step. Ran against an idle session —
      the server refuses /tree while a session is active.

Residual (closed in slice 11c): fold state of a collapsed *chain* node had
no visual cue once its caret was hidden. A folded row now keeps its caret.

## Slice 9 — Codify (done 2026-08-17, 72012f1 + d2fb94c)

- [x] docs/design-system.md rewritten as the as-built language (principles,
      full token contract, component grammar, verification ritual); the
      draft-target --fg- spec superseded, docs/design-audit.md marked
      historical
- [x] Focus ring → one token (--pi-focus-ring), 33 outlines across 17
      components consume it with a safe fallback; no visual change
- [x] Dead-duplicate audit: text-secondary is distinct from muted in every
      shipped palette — both stay

### Original scope

- [ ] Durable design-language doc (tokens, ramps, elevation, color semantics,
      chrome rules) under docs/
- [ ] Token contract cleanup: add missing tiers (focus ring, elevation),
      remove dead duplicates, document for plugin themes
