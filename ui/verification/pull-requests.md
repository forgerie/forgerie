# Pull requests (UI only)

Status: mockup with fixtures. No server route serves pull request data yet,
and a session is not linked to its pull request. The live app does not show
any of this.

Open `/verification/pull-request-preview.html?scenario=<name>` on the dev
server. Scenarios: `failed` (default), `waiting`, `blocked`, `ready`,
`watching`, `stopped`, `conflict`, `draft`, `merged`, `closed`, `loading`,
`error`, `asked`, `header`, `rows`.

What it shows:

- A header button with a dot in the verdict's colour. It opens the pull request.
- One verdict sentence, worst hold first: failed check, conflict, requested
  changes, running checks, draft, ready. A failure or a conflict puts its fix
  on the same line: "Ask the agent to fix 2 checks" or "Ask the agent to rebase".
- Watch: wake the agent on a failed check, all checks passing, another
  person's comment, or a conflict. Stopped watches say why. The guardrails
  come from T3 Code's `watch_pull_request`.
- Checks, failures first with the log tail open and scrolled to its end.
  Passed checks fold into one row.
- Open review comments with checkboxes, and "Ask the agent to address" them.
- Merge, offered only in the state `merge_pr` accepts, with a confirm step.
- A pull request mark on session list rows: number and verdict word.

"Ask the agent…" writes the request into the message box and closes the
panel. The reader sends it. GitHub text goes in a fenced JSON block, marked
as data, not instructions.

Capture all Fold 8 postures in both colour schemes:

```sh
APP_URL=http://127.0.0.1:8510 ./scripts/pull-request-shots.mjs
```
