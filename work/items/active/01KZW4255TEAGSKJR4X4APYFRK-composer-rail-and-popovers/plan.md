---
id: 01KZW4255TEAGSKJR4X4APYFRK
title: Anchor the composer's choices and reduce its rail
status: active
---

# Anchor the composer's choices and reduce its rail

## Why

Four defects, all observed and all drawn:

- Choosing a model or thinking level opens a **second modal over the first**,
  with its own scrim and its own focus trap.
- Session guidance **cannot be seen at all** in the new-session modal. The panel
  is `position:absolute; bottom:calc(100% + 8px)`, so it paints above the
  composer — outside `section[role="dialog"]`, which is `overflow:hidden`.
- **Cancel is stranded** below the rail, at the far edge from Send.
- The rail spends its width on words while the **model name — the only
  unpredictable value — is capped hardest** at `min(42cqi, 320px)`.

Wireframes: `/tmp/sheet/composer.png`, `choices.png`, `rail.png`,
`identity.png`, `branch.png`.

## Slices

1. **One anchored popover layer.** A single popover component replaces the
   `command-picker` modals for model and thinking, and carries guidance.
   Anchored to the control that opened it, left edges aligned, 8 px above the
   rail, width `min(348px, island − 16px)`, flips below when there is no room,
   may cover the prompt but never the rail. No scrim, no second focus trap;
   Escape returns to the draft. Content sized per choice: model is grouped by
   provider and searchable, thinking is 7 fixed rows, guidance is one switch.
   States drawn: catalogue error with Retry, filtered-to-nothing, unchosen.
2. **Cancel joins Send.** In the new-session rail, `✕` sits beside `➤`, same
   size, same row. The separate footer button goes.
3. **Reduce the rail.** Archive becomes an icon. Thinking loses its word and
   keeps its gauge. Guidance becomes an icon with a count badge that vanishes
   at zero. The new-chat button is removed. The ~336 px recovered goes to the
   model name, which then shows `anthropic/claude-sonnet-4-5-20250929` whole.
4. **State place only when it is unusual.** Nothing on the main worktree. Off
   it, a 12 × 12 inline-SVG branch mark, the `feat/`-style prefix dropped, and
   the label capped at `min(26cqi, 168px)`; the full ref stays in `title`.

## Evidence behind the choices

- `label === branch` in 12 of 12 workspaces sampled, so the old `main · main`
  lost nothing by dropping half.
- 30 non-main worktrees: median 30 ch, longest 45. Dropping the prefix takes
  what fits at 27 ch from 9/30 to 20/30.
- Prefixes are categories, not identities: `feat` 14, `fix` 5, `refactor` 4,
  `spike` 3, one each of `work docs chore ci`.
- The catalogue has 30 models over 4 providers, and 4 of them are
  `reasoning:false`, so thinking must show a clamp naming the model.

## Gates

- Each slice lands green as one commit, with the whole suite run.
- Chat behaviour changes only where a slice says it does.
- No control renders as a side effect of an absent field; capabilities decide.
- A popover never traps focus and never raises a scrim.
