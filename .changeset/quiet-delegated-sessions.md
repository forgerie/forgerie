---
"forgerie": patch
---

Keep agent-spawned sessions out of the inbox.

Sessions a subagent run creates no longer appear as rows of their own. Three
gaps are closed: a forked child was visible for the whole run, because the mark
that hides it was only written when the run ended; children of sessions the
daemon never streamed — terminal runs, or runs that outlived a restart — were
never marked at all, and the daemon now recovers those in the background at
startup from the parents' own transcripts; and writing the mark could destroy a
transcript that was still being appended to, which is now refused rather than
risked.

`npm run repair:spawn-marks` runs the same recovery by hand, and replaces
`scripts/backfill-agent-spawned.mjs`.
