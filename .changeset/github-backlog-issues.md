---
"forgerie": patch
---

List a project's open GitHub issues in the backlog and launch sessions from them. Set GitHub up once from the backlog: Forgerie creates its own read-only GitHub App and reads issues as that app, so nobody logs in and nothing expires. The app's key stays in Forgerie's data directory, no response returns a key or token, and Forgerie only reads from GitHub. Issues from outside contributors are hidden by default, and a launched issue reaches the agent as quoted, untrusted text.
