# Mobile chrome — design record

Static sketches behind the decision to make the chat surface content-first on
constrained panes. Open the HTML files directly; they have no dependencies.
Re-render a PNG with `chromium --headless=new --screenshot=... file://…`.

| File | What it shows |
|---|---|
| `01-where-space-goes.html` | The defect. Four permanent chrome bands (189px) leave 151px of transcript with the keyboard open. Compares "one hairline" against "zero chrome". |
| `02-top-hairline.html` | Rejected. A 36px hairline plus tabs that ride along while pinned to the bottom. Discarded once liveness moved into the transcript. |
| `03-content-first.html` | **The decision.** Nothing at the top edge. Liveness renders inside the transcript; identity and the summon control live in the composer row; everything else is a bottom sheet on request. |

## The decision

Resident chrome above the transcript goes to zero on constrained panes.

| Question | Answered by |
|---|---|
| Is it running? | `Working…` at the foot of the live turn, inside the transcript |
| Which session is this? | Quiet chip in the composer row |
| Give me the controls | `⌃` in the composer row, opening a bottom sheet |
| Something needs me | `ask_user` and errors render inline in the transcript |

Visible transcript: 490 → 733px with the keyboard closed, 151 → 340px with it
open. Numbers are read off the CSS in `src/client/src/components/shared.ts`,
not measured on a device.

## Constraints this design carries

- **The transcript must be able to report its own liveness before the top
  chrome can be deleted.** A screen with no chrome and no working indicator
  looks identical whether the agent is thinking, finished, or dead. This makes
  the streaming stance a prerequisite rather than a finishing touch.
- **Resident-versus-summoned is decided by available space, not by device.**
  The threshold is content-derived — the height the transcript needs to stay
  readable, plus the composer, plus the chrome — and mirrors the existing
  `appShell/shellLayoutMode.ts` pattern. Larger panes keep resident chrome;
  that is correct, not a fallback.
- **State survives the discrete change.** Scroll position, draft text, and
  sheet state hold across fold, unfold, and rotation.
- **No new viewport breakpoints.** The existing width breakpoints and the Fold
  cliff documented in `AGENTS.md` are untouched by this work and are tracked
  separately.

## Open cost

`Archive & next` moves into the bottom sheet, which makes the triage loop
read → archive → next two taps instead of one. Unresolved: whether archive
earns a place directly in the composer row.
