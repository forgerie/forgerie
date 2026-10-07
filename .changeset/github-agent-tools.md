---
"forgerie": patch
---

Give agents in Forgerie sessions `github_read` and `github_write` for their project's GitHub repo. Agents can read issues, labels, and pull requests with CI status; create, comment on, close, reopen, and label issues; open pull requests; and merge a pull request when every check on its head commit passed. The tools act as Forgerie's GitHub App, hide text by outside contributors unless the project lists everyone, and use only labels that already exist. New GitHub App setups ask for issue, pull request, and contents write access. An existing app needs its permissions raised on GitHub.
