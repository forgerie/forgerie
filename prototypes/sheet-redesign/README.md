# Five sheets, redrawn

A high-fidelity mockup of the Pull request, Workflows, Decisions, Child agents
and Managed processes sheets. It follows `DESIGN.md` (the tally sheet) and
copies its tokens from `ui/src/ui/theme.css`. Nothing here ships.

Open `board.html` to see every scene at desktop size and at two Fold 8
postures. Open `index.html?scene=<name>` for one scene at the window size.
Add `&still` to stop the blink. Run `./render.sh light` (or `dark`) to write
every scene at desktop and the four Fold 8 postures into `shots/`, which Git
ignores.

## What was wrong, and what each sheet does now

| Sheet | Before (screenshots of 2026-10-16) | After |
|---|---|---|
| All | Every sheet keeps a fixed tall body, so empty and short sheets are mostly blank. Body text starts at a different edge from the title. | The sheet is as tall as its content, up to the window. The title, the text and the rows share one edge; the margin column left of it belongs to marks and icons. A body that scrolls fades at its cut edge. Below 36 rem of window width the sheet becomes a bottom sheet with the same content. |
| Pull request | "Actions" and "Link a pull request" look like tabs but only duplicate the form below. One small field floats in an empty box. The hint says "142 or Azure PR URL" next to a stray `#`. | One heading says the task. The field takes a number or a link and reads the pull request before it links, so "Link #59" shows the title and state first. The open pull requests of the repository are listed under it, the one on this session's branch first, each with its own Link. Action runs stay in the header. |
| Workflows | Names and descriptions in one block of grey text. "7 stages; you decide at Approve landing" is the only hint of shape. | Each row draws its route: stages in order, one outlined block per agent the stage starts, a ringed block where you decide. Grouped by where the file lives. A filter field takes `/`. An unreadable file says which line is wrong and opens the file. |
| Decisions | Each decision takes four lines: "you settled a gated action", the action, "approved", "The user approved this tool call". Every row has a bold Overturn, even a branch deletion that cannot be undone. | Flagged guesses come first as decision cards with Overturn and Looks right. All other decisions are one line each, grouped by day, with repeats folded ("2 times"). Filter chips count each kind. A row opens to say what ran, where and in which run. A gated action says that a correction tells the agent but does not undo the action. |
| Child agents | Four rows say "Cannot read worktree" in grey, so a shared failure reads as four quiet statuses. 64-character branch names wrap the row. "Runs $26.58" in the header reads like a label. The footer says "0 ready to land". | One notice names the shared problem and offers Check worktrees. Each child has its block in the margin, so the state shows before the words. Branch names are cut in the middle with the full name on hover. Cost and time sit on the right of each row; the total moves to the footer as a sentence. A question is answered from its row; a ready branch has Review changes and Land on its row. |
| Managed processes | One sentence in a tall empty box. | Empty: what will show here, three example commands, and Ask the agent to start one. List: a signal dot, the command, and the last line it printed. Failed and lost processes say why. Detail: facts, a log with stderr tinted and a follow state, then stdin. In a short window the facts move behind Details so the log keeps its height. |

## Rules the mockup follows

- A block counts one unit of work, as `DESIGN.md` says. Child agents and the
  agents a workflow stage starts are blocks. Processes are not units of work,
  so they get a round signal dot.
- Outlined blocks mean "not reached yet", as in `prototypes/stage-strip-blocks`.
  A saved workflow has reached nothing, so all its blocks are outlined.
- Waiting for you is solid live blue with a wash ring. Working is blinking live
  blue. Done is neutral ink. Nothing healthy is coloured.
- A list in a sheet is rows with hairlines between them, never cards. The only
  boxed things are the field, the code tail lines and the log.
- Text that names what an agent did (a name, a branch, a command, a log line)
  is in the code font. Text written for the reader is in Public Sans.
- Below 30 rem of sheet width, a row's status moves under its name, before its
  detail and buttons. Nothing is removed at any size. Below 30 rem of window
  height, the process facts move behind a Details button, and the header and
  paddings shrink before the log does.

## Data the mockup needs that the client does not get today

| Shown | Needs | Where |
|---|---|---|
| Open pull requests under the field | A route that lists the open pull requests of the session's repository, with head branch, draft state and age | New server route. The agent's `github_read prs` action reads the same data |
| Title and state before linking | A read of a pull request by number without linking it | New server route, or `read` without a link |
| Workflows grouped by where they live | The source folder of each saved workflow | `workflowInventorySchema` has `path`; the client can group by it |
| Looks right on a flagged guess | A way to settle a flagged guess without overturning it | New decision state. Today only an overturn clears the flag |
| Last tool call of a working child | The child's latest tool name and summary in `ChildSummary` | New field |
| Cost and time per child | Per-child cost from the run records | `Runs` has the totals; per-child values are inferred, not checked |
| Last output line of a process | The last log line in `ManagedProcessInfo` | New field, or one output read per row |
| Ask the agent to start one | A way for a sheet to put text in the composer | Client only |

## Invented content

The pull requests #52, #57, #60 and #61, the decisions other than the six gated
actions in the screenshot, the per-child costs and times, all processes and
their logs, the split of workflows between the project and the profile, and the
unreadable `release-train` workflow are invented. The workflow routes, the four
child names and agents, the total of $26.58, and the gated actions with their
ages come from the screenshots and from `saved_workflows`.

## Open questions

- Should a ringed block mean "you decide" everywhere, including the run strip?
  `DESIGN.md` has no tone for a stop that is not yet reached.
- Overturn on a gated action that already ran: keep it as "Send a correction",
  or remove it for actions that cannot be undone?
- The Fold breakpoints here are guesses (36 rem window width, 30 rem sheet
  width, 30 rem window height) until they are measured on the device.
