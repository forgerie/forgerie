---
"forgerie": patch
---

Link and watch Azure Repos pull requests read-only using the server user's existing Azure CLI Entra sign-in, or an organization PAT with Code: Read. Show policies, statuses, reviewer votes, and human comments in the pull request panel without a merge action.

Cap Azure PR rate-limit delays at 15 minutes. Invalid Retry-After values fall back to 60 seconds rather than causing an indefinite lockout or an invalid-date error.

Before downgrading to a version without Azure PR support, back up `<data dir>/pull-requests.json`, then stop every Azure watch and unlink every Azure PR using the current version. The previous daemon accepts the version 2 file but treats Azure links as GitHub: their reads fail, watches follow the unreadable-watch stop rule, and pending notices may still be delivered. Stopping alone does not remove Azure records.

Reuse Azure CLI sign-in for both Azure backlog and PR reads when no PAT file exists. An invalid existing PAT remains an error. Configure `azureDevops.azureCliCommand` when the daemon cannot find `az`; on NixOS, use a pinned binary path. Access tokens are cached in memory, refreshed five minutes before expiry, and retried once after HTTP 401. Entra tokens carry the user's full Azure DevOps rights, while Forgerie's code only reads. Tokens are never given to agents; another process running as the same user can independently use the CLI sign-in. Entra policy can require `az login` again.

Prevent a 401 retry from reusing an Azure CLI refresh invalidated during temporary-directory cleanup. Cache credentials only after cleanup finishes, and report a cleanup failure once through a sanitized daemon warning.
