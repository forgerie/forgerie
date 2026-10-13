# The workflow proposal, with the plan as a document

Three candidates for the sheet that opens when an agent proposes a workflow
(`ui/src/workflows/WorkflowProposalSheet.tsx`). In each one the plan is the
main surface. It renders with the chat's own Markdown renderer
(`ui/src/ui/MarkdownText.tsx`), so a plan can use every block a reply can:
callouts, steps, facts, files, details, and the rest. The plan stays plain
Markdown, so the agent runs the same text you read. None of them replaces the
shipped sheet yet.

The mockups are React, not HTML, so that the plan uses the real renderer and
the real theme. They live in `ui/src/workflows/proposalMockups/` as one
Caliper part, `ProposalMockups.page.part.tsx`, with the states `default` (A),
`B`, `C` and `CInputsOpen`. Delete that folder when a candidate is built or
dropped.

| Key | Candidate | Idea |
| --- | --- | --- |
| A | Document first | The plan is a page you read. A rail beside it holds the route, the inputs and the buttons, with Start at the rail's foot. |
| B | Route as spine | The plan is cut at its stages. A spine lists the stages and the inputs, shows where you are, and jumps. In one column the spine becomes a bar of chips at the top. |
| C | Card deck | The plan is a board: an overview card, then one card per stage. The inputs and the buttons share a launch bar along the bottom. |

## Rendering

```sh
cd ui && npm run dev            # caliper() must run
cd prototypes/workflow-proposal-document
./render.sh http://localhost:8510 light   # or dark
```

`render.sh` screenshots each candidate at six sizes and writes one labelled
sheet per candidate to `shots/`. Only the three light sheets are in Git.

## Rules all three follow

- The sheet grows to 72rem by 52rem. Each axis gives up its margin before the
  content shrinks, as `SheetDialog` does today.
- Layout depends only on the sheet's size, through container queries. Two
  panes from a sheet width of 50rem. A tighter header and footer below a
  sheet height of 30rem. C folds its inputs to one line below a height of
  36rem. All thresholds are guesses until measured.
- Start, Ask for changes and Dismiss stay in view at every size.
- The plan's title is the sheet's title, so the document drops its `#`
  heading. The workflow's name is set in the code font beside it.
- A planned worker is one hollow block. A stop for you is a "You" chip.
- The fixes from the review of the shipped sheet: the plan comes before the
  inputs, inputs have sentence-case labels, Review rounds is a stepper, the
  branch is a segmented choice, and the title outweighs the task text.

## Content

The proposal is the `settings-store-port` fixture
(`ui/src/workflows/fixtures/proposals.ts`). Its plan is rewritten with rich
blocks in `ui/src/workflows/proposalMockups/planDocument.ts`. The file paths
in the `files` block are invented.

## What a build would need

- A Markdown view that renders the chat's blocks without a chat message. The
  mockup wraps the plan in a one-message thread (`PlanMarkdown.tsx`); a build
  should give `MarkdownText` a context-free entry instead.
- For B and C, a rule that ties a `## ` section to a stage. The mockup matches
  the heading to the stage's name.
