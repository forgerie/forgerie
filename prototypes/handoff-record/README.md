# Handoff record

**Status: study, no verdict yet.** Four treatments for the turn a `/handoff`
leaves behind. The verdict goes here when one is picked.

## The problem

Today a `/handoff slow first full-library startup` turn renders as three
things that say nothing: a `[skill] handoff` card inside a bubble, a second
bubble holding the focus text, and a rail line reading `✓ 2 steps`. The
reader has to open the fold and read a tool result to learn that a new
session exists, where it is, and whether it is ready.

What the transcript actually holds for that turn, verified with the client's
own `normalizeMessages` + `groupChatMessages` over a real session file
(`pyxis`, 2026-09-07):

| Wire | Rendered as |
|---|---|
| `user` text `<skill name="handoff" ...>...</skill>\n\nslow first full-library startup` | two user lines: `skillInvocation` + text |
| `assistant` `toolCall handoff_session {focus}` | one `toolExecution` step |
| `toolResult` with `details: {handoffId, destinationSessionId, cwd, model, state: "preparing"}` | merged into the step |
| `custom` `forgerie.handoff.lifecycle` entries (`requested` → `destination-created` → `source-detached` → `preparing` → `ready`) | not projected; `historyMessages` skips non-display customs |

So the data for a real record is already on disk. The `ready` transition
lands in the source file minutes later (5m 05s and 1m 22s for the two real
handoffs), which is what makes a state readout possible without polling the
destination.

## The treatments

Open `index.html`, flip with the floating bar, arrow keys, or `#variant`.

| Key | Name | What changes |
|---|---|---|
| `today` | Baseline | Skill card in a bubble, focus in a second bubble, `✓ 2 steps` on the rail. |
| `receipt` | A · Receipt on the rail | One bubble: `/handoff` command mark + focus, skill text one tap behind the caret. The rail line says `↗ handed off · pyxis · ready after 5m 05s` with `Open session`. The step ledger stays behind the caret. |
| `record` | B · Record | Same bubble. No rail. The handoff's own record stands where the answer would: title row (`Continuation session · pyxis · gpt-6-astra · 01a07c5b`), state row (`✓ ready · 5m 05s`), `Open session →`. |
| `thread` | C · Live thread | B's shape, but once the handoff is `ready` the state row becomes the destination session's live board state, in the inbox's own vocabulary and tones: `blocked on you`, `working · 4 steps`, `preparing context`. |
| `boundary` | D · Boundary | The whole turn folds into one centred rule, in the register of `Beginning of session`: `↗ handed off · <focus> · ready · Open session ▸`. |

All four share the command bubble except D. The bubble reconstructs what was
typed (`/handoff <focus>`) using the command mark the composer and queued
ghosts already draw, so a slash command looks the same before and after it is
sent.

## What each one costs

- **A** keeps the rail and the ledger, so it is the smallest change and the
  step count survives behind the caret. It still spends a hairline and a
  disclosure on a turn with one step.
- **B** needs a new `handoffRecord` chat part projected from the tool result
  plus lifecycle entries. The model and short id truncate away first under
  30rem; both survive in the destination's own header.
- **C** is B plus a subscription to the destination's board state. It answers
  the question the reader actually has after a handoff (do I need to go
  there?), but it is the only variant whose content changes after the source
  session is closed, and it will need a rule for a destination that is
  archived or deleted.
- **D** is the quietest and reads well when several handoffs stack, but it
  hides the typed command inside a rule and wraps to two centred lines at
  475px, which is the width where the boundary register already struggles.

## Postures

`render.sh` captures each variant at three postures over CDP emulation
(932×553, 475×638, 711×374). The record's readouts respond to their own
container (`@container record`), not the viewport: below 30rem the model and
id leave the head; below 22rem `Open session` takes its own row.
