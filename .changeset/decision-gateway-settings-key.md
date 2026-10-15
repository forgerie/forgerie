---
"forgerie": patch
---

Let Settings save, replace and remove the Decision hints gateway key in the active profile with private atomic writes. Sessiond applies file changes on the next request without restarting. Environment keys retain precedence and remain read-only in Settings. Document that the saved key has the same agent and browser file-route exposure as auth.json and cliproxyapi.json; use DECISION_GATEWAY_API_KEY to keep it out of both.

Reject key-bearing daemon redirects. Read credentials asynchronously inside detached asks. Keep invalid saved files fail-closed and repairable in Settings.
