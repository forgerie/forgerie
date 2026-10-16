---
"forgerie": minor
---

The Child agents, Managed processes, Workflows, Decisions and Pull request sheets are redrawn. A sheet is now as tall as its content instead of a fixed tall card, and it still takes the whole screen once it meets the side edges.

- **Child agents:** each child has a tally block in the margin for its state. A worktree error that several children share shows once, above the list. Long branch names are cut in the middle. Each child shows its cost, and the footer shows the total. You can answer a question, or review and land a branch, from its row.
- **Managed processes:** each row shows the command, the pid, and how long it has run or how long ago it ended. A failed exit names its exit code. In the log, lines from stderr are tinted. An empty list explains what shows there and can put a request in the message box.
- **Workflows:** saved workflows are grouped into This project and Your profile. Each one shows its stages, with a mark for every agent a stage starts and a ringed mark where you decide. A filter field appears when you have five or more.
- **Decisions:** flagged guesses come first, in full. Every other decision is one line, grouped by day. Repeats fold into one line that says how many times. Toggles narrow the log to one kind. On a gated action, Overturn is now **Send a correction**, because the action already ran and a correction cannot undo it.
- **Pull request:** with nothing linked, the sheet shows one link form and no tab strip. The form takes a number or a link, the button names the number it will link, and text that is neither says so.
