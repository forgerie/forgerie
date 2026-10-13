# A workflow stop can pass without the user

Status: accepted, 2026-10-12

Any workflow stop, approve or land, can be set to pass automatically. The setting has a global default in Forgerie Settings, which is off, and a workflow opts in on the stop itself. At an automatic approve stop, the parent approves and records a decision. At an automatic land stop, the run lands its branches only when all three hold: review has no must-fix findings, the full verification passes on the merged branches, and the merge onto the default branch has no conflicts. If any condition fails, the stop becomes an escalation and waits for the user. Every automatic pass is a decision in the run's decision log.

## Considered options

- Land only when review has no must-fix findings: faster, but a red build or a conflict can reach the default branch.
- On by default, with workflows opting out: removes the user from the loop sooner, before the user knows how far to trust it.
- Only land stops can pass automatically: keeps approve stops with the user, but makes two rules where one does.

## Consequences

Code can reach the default branch without the user reading it first. Undoing it is a revert.
