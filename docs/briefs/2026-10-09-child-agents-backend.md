# Brief: child agents and workflows, back-end work

Date: 2026-10-09. For one agent working alone.

Scope: server, API, data, storage, and tests. Out of scope: anything a person sees, such as components, CSS, layout, and copy. A separate design pass builds the UI on the contracts this work defines.

## Read first

| File | Why |
| --- | --- |
| `docs/child-agents.md` | What exists now: the `child_agent` tool, routes, restarts, limits. |
| `prototypes/durable-child-spike/README.md` | Spike results and findings 1 to 8. Findings 4 and 5 are still open. |
| `docs/pi-durable-migration.md` | Durable status. "Delegated recovery" and "Dialogs" acceptance rows are still Pending. |
| `AGENTS.md` | Worktree rule, deployment rule, pi-subagents policy. |
| `AGENTS.local.md` | How the systemd units run on this machine. |

Code:

- `src/server/sessions/durableChildAgents.ts`: the child extension (anchor task, reporter task, `ask_human`, `child_agent`) and host operations.
- `src/server/sessions/durableChildHost.ts`: per-session extensions and the live-children index for restart resume.
- `src/server/sessions/durableChildProfiles.ts`: agent-file reader.
- `src/server/sessions/durableChildRoutes.ts`: `/sessions/:id/children` routes.
- `src/server/sessions/durableAgentSession.ts`, `durableSessionJournal.ts`: how a Durable session hosts children and projects their entries into the JSONL transcript.
- `src/server/sessions/piSessionService.ts`, `src/server/sessiond.ts`, `src/config.ts`: wiring and the `durableChildren` flag.
- `src/server/workspaces/sessionWorktrees.ts`, `sessionWorktreeStore.ts`, `docs/session-worktrees.md`: existing worktree create, land, and discard for sessions.
- `src/server/uiSettings/agentFiles.ts`: the file-backed API pattern to copy for workflow files.

## Decisions already made

Do not reopen these without new evidence. Ask the user if you have that evidence.

- The main thread coordinates. A reviewer is a separate, fresh agent.
- The product does not encode any one workflow. Workflows are files the user owns, and they must be easy to create, copy, and change.
- A workflow file is prose first, with an optional script block.
- The live Pi profile is `~/.local/share/forgerie/agent`, not `~/.pi/agent`.
- Durable-native children replace pi-subagents in stages. Both load side by side until the top uses work on Durable. In the 30 days before 2026-10-09, those uses were `reviewer` (152 runs), `worker` (82), `rgds-committer` (47), `delegate` (31), and `scout` (28).
- A child's question never starts a model turn for the parent.
- Worktree cleanup removes a worktree only if it is clean, its branch is merged, and no live session uses it. It never deletes uncommitted work automatically.
- Child agents stay behind `durableChildren` until item 1 below passes.

## Rules

- Work in `.worktrees/<name>` on a branch from `main`. Land by rebase and fast-forward, then remove the worktree.
- Use Node 24: `nix shell nixpkgs#nodejs_24`. Run `npm run verify` before each commit.
- Do not restart the production `forgerie-sessiond.service` while any session is running. A restart kills in-flight runs. For tests, run a separate sessiond with its own `PI_WEB_DATA_DIR`, `PI_WEB_CONFIG`, and `PI_WEB_SESSIOND_PORT`.
- Do not edit `ui/` components or CSS. You may add fields to the zod schemas in `ui/src/childAgents/childAgentsModel.ts`, so the browser keeps parsing your responses. Change nothing else under `ui/`.
- For every API change, update the "API" section of `docs/child-agents.md` with the exact request and response shapes. The design pass builds from that section.
- Ask the user before you change the pi-subagents policy in `AGENTS.md`, stop loading pi-subagents, or delete a worktree that has uncommitted work.

## Work, in order

### 1. Real-model end-to-end check

Run child agents against a real model through CLIProxyAPI on a separate sessiond. Cover:

- spawning from an agent file;
- a child that writes a file with Durable's coding tools;
- a steer;
- a stop;
- a question and its answer;
- a sessiond kill (`SIGKILL`) while a child works, then resume.

Done when each case passes, with evidence: transcript excerpts and file effects. Fix the defects you find. Record the results in `prototypes/durable-child-spike/README.md` under a new "Real-model run" heading.

### 2. Several children at once

The parent spawns 3 children in one reply. Check that they run in parallel, report once each, and survive a restart without duplicates.

Done when one test covers this through `PiSessionService`, and it passes 3 runs in a row.

### 3. A worktree for each child

Two children that edit the same files now collide.

- Add an optional `isolation: "shared" | "worktree"` to `child_agent` spawn. Default: `shared`.
- For `worktree`, create a git worktree from the parent's `HEAD` with the existing session-worktree code, and set the child conversation's `cwd` to it.
- Creating a worktree is a side effect outside the Durable commit. Make it idempotent with a deterministic path or branch per child, so a rerun after a crash never creates a second worktree.
- The child's report to the parent names its branch and a short diff summary: files changed, commits ahead.
- Add host operations and routes to land (rebase and fast-forward) and discard a child's worktree. Discard needs an explicit confirmation token, as the session-worktree discard does.
- Add `worktree?: { path, branch, state: "active" | "landed" | "discarded", ahead, dirty }` to `DurableChildSummary`.

Done when tests cover create, restart without a duplicate, land, discard, and the summary fields.

### 4. Worktree cleanup

- Use `.worktrees/` for new allocations. The user chose this folder on 2026-10-09. Existing `.worktree/` checkouts stay at their recorded paths. Ask before moving any checkout.
- Add a cleanup job that applies the rule in "Decisions already made".
- Add an API that lists every worktree the job kept, with the reason: dirty, unmerged, or in use by a session.

Done when tests cover each keep reason and one removal. The job must never remove a worktree with uncommitted files.

### 5. Run record

Record each child run:

- child name and agent file, with a hash of the file;
- model;
- start, end, and duration;
- cost and tokens, from Durable's `pi.usage`;
- number of turns;
- outcome: answered, failed, or stopped;
- the session it belongs to.

Store the records on disk under `PI_WEB_DATA_DIR`. Propose a retention period; 90 days is a reasonable default. Add a read API that filters by session and by agent.

Done when tests cover write, read, filter, and retention.

### 6. Workflow library, back end

- **File format.** A superset of the Pi prompt-template format. Add frontmatter for declared settings, each with a name, a type, choices, and a default. Allow an optional fenced `js workflow` block in the body.
- **Discovery.** Read project files, then profile files. Propose the folder names.
- **Parser.** Test it with valid files and with broken files.
- **File API.** List, read, write, and delete, following the pattern in `src/server/uiSettings/agentFiles.ts`.
- **Launch API.** It takes a workflow and setting values, expands the prose, and sends the result as the session's prompt.
- **Run record.** Each launch records which workflow file and version ran, linked to the run record from item 5.

Stop and ask the user which runtime the script block uses before you build it. The options known so far:

1. A codemode script that calls `child_agent`. This keeps scripts on Durable, but it is untested.
2. pi-subagents' `runs` API. This works today, but it ties scripts to pi-subagents, which is being replaced.

Done when the prose path works end to end in a test: write a file, list it, and launch it with settings.

### 7. Optional: fewer parent turns

Each child's report starts a parent model turn, which costs tokens. Propose a mode in which reports arrive as write entries and the parent wakes once, when all the children it waits on are done. Build it only if the user agrees.

## Report back

Report these items:

- commits on `main`;
- test counts;
- every API change, with a link to the updated `docs/child-agents.md` section;
- each item not done, and why;
- open questions, each as one question with options.
