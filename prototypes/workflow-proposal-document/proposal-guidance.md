# Draft: guidance for writing workflow proposals

Historical draft. The live guidance now lives in the `propose_workflow`
description in `src/server/sessions/durableWorkflowRuns.ts` and in
`REPLY_FORMAT_GUIDE` in `src/shared/replyFormatGuide.ts`. Those sources keep
the existing stop rules and the guide's 3,000-character budget. This draft
records the comparison only; do not copy it over the live text.

## 1. The tool description

> When you understand a task that needs several workers, a review, or the
> user's check, design a workflow for this task, call propose_workflow, then
> end your turn. Not for small tasks. Never write a workflow file into the
> repository for a one-off workflow. Supply complete prompt-format text with
> workflow version 1 frontmatter and prose, and pre-fill its inputs. The user
> reads the prose first, beside the route and the inputs; the run then
> follows the same text. Write it for both readers, as "Workflow proposals" in
> the reply format says. Only the user can start the proposal, ask for
> changes, or dismiss it.

## 2. The guide section

> ### Workflow proposals
>
> The prose of a `propose_workflow` text is the exception to "never in
> files": the user reads it in the browser app before the run follows it. Use
> the blocks there.
>
> - Frontmatter `description`: a plain title, 90 characters at most. The
>   sheet shows it as the title, so add no `#` heading. Give each input a
>   `description`; it is the input's label.
> - Open with two or three sentences on the outcome. Then callouts for what
>   must not happen and whether the user is in the loop, and a `facts` block.
> - One `## ` section per stage, headed with the stage's name, in route
>   order. Other sections, such as facts or rules, have their own headings.
> - In a stage section: one sentence on what happens; `steps` for ordered
>   actions; a list for parallel workers; a `> [!WARNING]` callout starting
>   `**Gate.**` for each condition that stops or rolls back the run.
> - Material the run needs but the user can skip goes in `details`.
> - Name inputs, such as `rollback_days`; never repeat their values.
