---
"forgerie": patch
---

Show a session's running workflow in the inbox. A row whose session runs a
workflow grows a third line: a block per stage in its state, the name of the
stage at work or waiting, and a count of what waits on you. The stage name turns
blue when a stop waits for your decision and red when a stage failed. A long run
folds its first stages into a `+n` count so the line fits the list. The line goes
away when the run finishes; rows without a run are unchanged.
