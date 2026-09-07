---
"forgerie": patch
---

Draw a skill invocation as the command that was typed, and open the session a handoff created from its own bubble.

Pi expands `/name args` into a skill block plus the argument, and the transcript
split that back into two user lines: a bordered `[skill]` card inside the user's
bubble, then the argument stranded in a second bubble. Because a turn starts at
every user line, one typed command also became two turns. It is now one bubble
and one turn, drawn with the same command mark the composer and the queued
ghosts use, and the mark opens the skill's own text. This applies to every
skill, not only `handoff`.

A turn that created a session now carries a door in that bubble's tail: an
arrow that opens the destination, including when it lives in a sibling
worktree. It appears only when a tool actually made a session
(`handoff_session` or `spawn_session`, on success), so an ordinary skill turn
and a failed handoff keep no arrow. Session state stays in the inbox, which
already reports preparing, working, and blocked-on-you.

The call the door reports no longer counts as a step on the rail, so a handoff
turn reads as a command and a door instead of also claiming there is work to
inspect. Any other step in the turn still counts, and a failed call keeps its
place on the rail, which is the only thing that reports it.
