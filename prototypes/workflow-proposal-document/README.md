# The workflow proposal, with the plan as a document

A candidate for the sheet that opens when an agent proposes a workflow
(`ui/src/workflows/WorkflowProposalSheet.tsx`). The plan is the main surface:
a page you read, rendered with the chat's own Markdown renderer
(`ui/src/ui/MarkdownText.tsx`), so a plan can use every block a reply can:
callouts, steps, facts, files, details, and the rest. The plan stays plain
Markdown, so the agent runs the same text you read. A rail beside the plan
holds the route, the inputs and the decision. It does not replace the shipped
sheet yet.

This is candidate A, "document first". Two other candidates, "route as spine"
and "card deck", were dropped on 2026-10-13. They are in Git history at
commit `68084ac8`.

The mockup is React, not HTML, so that the plan uses the real renderer and
the real theme. It lives in `ui/src/workflows/proposalMockups/` as one
Caliper part, `ProposalMockups.page.part.tsx`, with one state for each state
of the shipped sheet. The states work: Start, Ask for changes, Dismiss, the
route, the inputs and Retry all respond. Delete that folder when the sheet is
built or the idea is dropped.

## Rendering

```sh
cd ui && npm run dev            # caliper() must run
cd prototypes/workflow-proposal-document
./render.sh http://localhost:8510 light   # or dark
```

`render.sh` writes three labelled sheets to `shots/`. Only the light sheets
are in Git.

| Sheet | Shows |
| --- | --- |
| `sizes-light.png` | The proposal at six sizes, from a 1440 × 900 desktop to the folded Fold in landscape. |
| `states-wide-light.png` | Every other state at 1180 × 820. |
| `states-narrow-light.png` | Every other state at 475 × 638. |

## Layout

Layout depends only on the sheet's size, through container queries. All
thresholds are guesses until measured.

| Sheet size | Layout |
| --- | --- |
| 50rem wide or more | Two panes. The plan on the left, at most 40rem wide. The rail on the right: the route, the inputs, then the decision at its foot. |
| 50rem wide or more, under 36rem tall | The same, but the inputs fold to one line above the buttons, so the route keeps its room. |
| Under 50rem wide | One column. The plan, then the route. The inputs fold to one line above the buttons. |
| Under 50rem wide, under 30rem tall | The inputs line and the buttons share a row. The note yields. |

Start, Ask for changes and Dismiss are in view at every size.

## What the sheet does

- **The route jumps.** Each stage in the rail opens its section of the plan.
  The stage whose section is in view is marked. A section's heading carries
  its stage's number, so the plan and the route read as one.
- **The route names the work.** Each stage lists its workers by name and
  agent. A planned worker is one hollow block. A stop for you is a "You"
  chip.
- **Edited inputs are marked.** An input you changed says "Edited", says what
  the agent proposed, and can go back to it. The folded inputs line counts
  the edits.
- **The plan never repeats an input.** The plan says "when the review rounds
  run out", not "after 2 rounds". So an edited input never contradicts the
  plan.
- **A decided proposal goes quiet.** Started, Dismissed, Changes sent and
  Replaced each replace the buttons with one line. The inputs become read-only.
- **Until the record arrives**, the sheet shows what the chat card knows: the
  summary and the route. A failed read shows the reason and Retry.

## Content

The proposal is the `settings-store-port` fixture
(`ui/src/workflows/fixtures/proposals.ts`). Its plan is rewritten with rich
blocks in `ui/src/workflows/proposalMockups/planDocument.ts`. The file paths
in the `files` block are invented. The prose-only state uses the
`flaky-test-hunt` fixture as written.

## What a build would need

- A Markdown view that renders the chat's blocks without a chat message. The
  mockup wraps each piece of the plan in a one-message thread
  (`PlanMarkdown.tsx`); a build should give `MarkdownText` a context-free
  entry instead.
- A rule that ties a `## ` section to a stage. The mockup matches the heading
  to the stage's name. Stage ids in the heading, or sections in the workflow
  definition, would be firmer.
- Guidance for agents that write proposals: use the blocks, one `## ` section
  per stage, and do not repeat input values in the plan.
