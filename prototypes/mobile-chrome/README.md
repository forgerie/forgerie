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

## Measured result

Transcript element height and the chrome above it, measured through CDP with an
emulated viewport against a real 2,729-message session. `chat top` is the pixel
where the transcript begins.

| Posture | Chrome above, before | after | Transcript, before | after |
|---|---|---|---|---|
| Folded portrait 499×789 | 153px | **0** | 483px | 646px |
| Folded landscape 789×499 | 147px | **0** | 191px | 356px |
| Unfolded portrait 739×979 | 153px | **0** | 665px | 836px |
| Unfolded landscape 979×739 | 108px | 51px | 470px | 527px |

The first three postures are narrower than the 820px dock threshold, so chrome
is summoned and the transcript starts at the top edge. Unfolded landscape docks
and keeps its bands; its 57px saving is the thread header, deleted at every size.

Earlier estimates in this document were read off the CSS and ran optimistic.

## Capture note

Measure with an emulated viewport (`Emulation.setDeviceMetricsOverride`, as
`scripts/capture-screenshots.mjs` does), not `chromium --window-size`. The latter
sizes the window rather than the viewport, so the screenshot carries dead space
at the bottom that looks like a layout defect and is not one.

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

---

## Below the transcript, measured again (2026-08-10)

The chrome above the transcript went to zero; the area below it was still a
composer plus a status bar. The floating composer island
(`work/items/active/01KZQD4T7N8B2K5M9V1XW3PH6C-floating-composer-island/`)
retires the bar and folds its readings into the sheet the composer summons.

Measured with the same CDP emulated-viewport method, at rest with an empty
draft, on the same session in both builds:

| Posture | Resident below transcript, before | After |
|---|---|---|
| Unfolded portrait 739x979 | 145px (composer 114 + meter 2 + bar 29) | **125px** |
| Unfolded landscape 979x739 | 145px | **125px** |
| Folded portrait 499x789 | 145px | **125px** |
| Folded landscape 789x499 | 145px | **125px** |

Twenty pixels back at every posture, and one surface instead of three. The
gain is smaller than the bar's own height because the island pays for its
gutter, border, and internal padding — the calm is the larger part of the
return, and the readings the bar carried are now a tap away rather than
permanently on screen.

The open cost recorded above is resolved: `Archive & next` sits on the rail
whenever the island is at least 700px wide, and in the sheet when it is not.
