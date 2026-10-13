---
"forgerie": patch
---

Link and watch Azure Repos pull requests read-only using the organization's existing PAT with Code: Read. Show policies, statuses, reviewer votes, and human comments in the pull request panel without a merge action.

Cap Azure PR rate-limit delays at 15 minutes. Invalid Retry-After values fall back to 60 seconds rather than causing an indefinite lockout or an invalid-date error.

Before downgrading to a version without Azure PR support, back up `<data dir>/pull-requests.json`, then stop every Azure watch and unlink every Azure PR using the current version. The previous daemon accepts the version 2 file but treats Azure links as GitHub: their reads fail, watches follow the unreadable-watch stop rule, and pending notices may still be delivered. Stopping alone does not remove Azure records.
