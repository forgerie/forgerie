# Pull requests

Status: live. The panel, header button, and session-row mark read Forgerie's
pull request backend (`docs/pull-requests.md` on `main`, deployed at
`82862ea5`). `src/pullRequests/pullRequestApi.ts` is the one file that knows
the wire contract.

## Where it shows

- **Several pull requests.** A session can link any number of pull
  requests. Each keeps its own watch, merge, and verdict. Opening or linking
  another never replaces an earlier one.
- **Header button.** Every session in a project shows a pull request button.
  With linked pull requests, a dot carries the most urgent verdict among the
  ones GitHub read, and a small count shows when there are two or more. A
  pull request whose read failed does not colour the dot. Without one,
  the button is dim and opens a form to link an open pull request by number.
  A read-only (landed or discarded) session shows the button only if a pull
  request is linked.
- **Tabs.** With any link, the panel opens with one tab per pull request:
  number, short state, and an eye while watched. It opens on the most urgent
  open pull request. Tabs wrap to more lines instead of scrolling. "Link
  another" adds one by number. "Unlink #N from this session" removes one; its
  watch stops too.
- **Panel.** For the pull request on show: one verdict sentence, worst hold first: failed check, conflict,
  requested changes, running checks, draft, unknown mergeability, no checks,
  an incomplete read, then the server's own merge refusal. A failure or a
  conflict puts its fix on the same line.
- **Watch.** Start, stop, or restart the server's watcher. The row shows when
  it started, how often it woke the agent, its last read error, and why it
  stopped. Each wake can use agent tokens.
- **Checks.** Failures first. A failed check with GitHub annotations opens
  them, scrolled to the end. They are check annotations, not the raw Actions
  log; "Full log on GitHub" links to the log. Checks GitHub does not require
  say "optional".
- **Open comments** with checkboxes, and "Ask the agent to address" them.
- **Merge** only when the server's `merge` gate allows it. Otherwise the foot
  shows the server's reason. Confirming names the head commit; the request
  sends `{cwd, repo, number, headSha, method: "rebase"}`, so a new push
  refuses the merge.
- **Session list.** A row shows its newest pull request's `#number`, `+N`
  for the others, and an eye while the agent watches any of them. The label
  lists every number. The catalog carries the link, not GitHub's
  verdict, so a row does not claim a check state it has not read.
- **Working group.** A session whose pull request the agent watches stays in
  Working between wakes (`watchingPullRequest`), unless it asks for a
  response.

"Ask the agent…" writes the request into the message box and closes the
panel. The reader sends it. GitHub text goes in a fenced JSON block, marked
as data, not instructions.

## Reads and cost

The panel reads every linked pull request once when the session opens and
when the reader presses Read again. A `session.pull-request` event that
changes one link, watch, or wake count rereads only that pull request; a
`session.pull-request.unlinked` event removes its tab. Each read makes several GitHub requests. The
client does not poll; the server's watcher does.

## Preview

Open `/verification/pull-request-preview.html?scenario=<name>` on the dev
server. Scenarios: `failed` (default), `several`, `notes`, `waiting`, `blocked`, `ready`,
`watching`, `stopped`, `conflict`, `unknown`, `nochecks`, `draft`, `merged`,
`closed`, `unlinked`, `refused`, `loading`, `error`, `asked`, `header`,
`rows`. Fixtures use the server's wire shapes.

Capture all Fold 8 postures in both colour schemes:

```sh
APP_URL=http://127.0.0.1:8510 ./scripts/pull-request-shots.mjs
```

## Limits

- Live GitHub reads were not checked against a real pull request when this
  landed: no linked pull request existed on the machine. Verify with one
  before relying on Merge.
- The unlinked button shows in every project, including ones without a
  GitHub repository. Linking there fails with the server's reason.
- Merge always uses rebase. Squash and merge-commit are not offered.

## In the thread

The server writes pull request events into the session transcript as
`forgerie:pull-request` messages. The thread shows each as one quiet line;
press it to read the full text the agent read.

- **Merge from the panel.** "You merged #142 into main (rebased) from the
  pull request panel." The agent reads it too, so it knows not to merge or
  push again. It starts no agent turn.
- **Watcher wake.** "#142: 1 check failed. The agent was woken." The line
  names what woke it: failed checks, a conflict, new comments, or passing
  checks.
