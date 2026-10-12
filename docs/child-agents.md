# Durable child agents

Saved prose workflows can group Durable child runs into experiments. See [Saved prose workflows](workflows.md) for input snapshots, copying, and explicit completion.

Status: opt-in. Set `"durableChildren": true` in the Forgerie config, or `PI_WEB_DURABLE_CHILDREN=1`, and restart the session daemon.

A session can run background child agents inside its own Durable storage. The agent starts one with the `child_agent` tool. You do not switch sessions to follow it.

## What you can do

| Action | Where | Effect |
| --- | --- | --- |
| See every child | The robot control in the session header | Lists the session's children. Children with a question for you come first, then working ones. The badge counts open questions; a dot means a child is working. |
| Read a child | Open it from the list | Shows its task, its tool calls with folded output, and its replies as they stream. |
| Steer a child | The reply box in the open child | While it works, your message joins its run at its next tool call. When it is idle, your message is a new task. |
| Stop a child | Stop in the child header | Ends the child's current work and closes unanswered questions. The parent keeps running. |
| Answer a child | The question card in the parent thread, or in the open child | The answer goes to the child. The parent model gets no turn. |

Finished worktree children show Review changes, Land, Discard, and Continue working in the footer. Land stays disabled for dirty or unreadable worktrees. Discard first lists the commits and files to remove and requires confirmation. A refused action keeps the worktree and shows the reason.

After removal, Start new task from the named default branch creates a new child in a fresh worktree. It copies the old child's agent settings, not its transcript. It never makes the old conversation writable again. Unsent drafts survive changing child views, opening history, and closing the panel. They stay in memory, not across page reloads or switching parent sessions.

Run history is in the header. It shows retained runs, estimated costs, turns, tokens, and agent-file provenance. Worktrees opens the last automatic cleanup report. Refresh reads the report; it does not start cleanup.

The parent model sees each steer and stop as a note, so it does not undo what you told a child. Each child's final answer reaches the parent as a new message, and the parent continues from it.

Esc in the parent does not stop its children.

## Agent files

`child_agent` may name an agent file with `agent`. Forgerie reads the same files as pi-subagents, in this order: the project's `.pi/agents/`, the profile's `agents/`, Forgerie's own `agents/`, then the bundled pi-subagents agents. The first file with the name wins.

Forgerie's `agents/reviewer.md` replaces pi-subagents' reviewer for Durable children. The pi-subagents file says `watchdog_diff` cannot read committed ranges and forbids shell commands, which is true there and false here; a real-model check showed reviewers following it and asking the user for diffs instead of reviewing. Forgerie's reviewer reads committed ranges, runs read-only commands and requested tests, and still never changes the repository: it names a scratch merge as work for the parent. `REVIEWER_REAL=1 ./scripts/reviewer-real.ts` repeats the check; `REVIEWER_AGENTS=bundled` uses only pi-subagents' files.

Forgerie reads these frontmatter keys: `name`, `description`, `model` (with an optional `:thinking` suffix), `thinking`, `tools`, `skills`, `skillPath`, `inheritSkills`, `inheritProjectContext`, and `disabled`. A file that lists `fallbackModels` is skipped. Other keys are ignored.

Agent files are written for pi-subagents. `src/server/sessions/durableChildRuntime.ts` translates each one, in one place, and never drops a capability silently:

| Agent file names | A Durable child gets |
| --- | --- |
| `read`, `write`, `edit`, `bash` | Durable's coding tools. `read` also returns PNG, JPEG, GIF, and WebP files as images, up to 3.75 MB. |
| `grep`, `find`, `ls` | `bash`. |
| `contact_supervisor` | `ask_human`, which asks the user in the parent's chat. Every child has it. |
| `watchdog_diff` | Forgerie's read-only `watchdog_diff`. Without `range` it shows uncommitted changes against `HEAD` plus untracked paths, as in pi-subagents. With `range` it shows a committed range's commits and diff. `cwd` picks another repository or worktree, and `offset` pages through output longer than 60,000 characters. |
| `skills` | A list of those skills' files in the child's instructions. `skillPath` folders, relative to the agent file, come first, then the skills the parent session sees. `inheritSkills: true` lists every session skill. |
| Other named tools registered in the parent session | The session's tool, including extension tools such as `web_search`, `fetch_content`, `get_search_content`, and `source_check`. The parent's active-tool selection does not limit sharing. Argument validation and extension `tool_call`/`tool_result` hooks still apply. |
| Missing or excluded tools | Nothing. The child's instructions say `Not available here: …`, and the parent's spawn result says `Not available to it here: …`. Excluded tools include parent-only tools, tools with `model-only` or `hidden` exposure, and names in `childToolsDeny`. |

Without `tools`, a child gets every child-native tool, not the parent's extension tools. A child cannot start children of its own.

Tools registered after the session opens become available to new spawns and parent sends without a reload. Shared tools resolve from the parent's current registry by name at call time, including after `/reload`. Each child call has its own ID. Shared calls are replay-unsafe: an interrupted call is reported, not rerun automatically. A tool removed or excluded after spawn returns an explicit unavailable error.

Each `send` from the parent reads the child's agent file again and applies the current tools, skills, and instructions before the message arrives. A child spawned under an older Forgerie, or before its file changed, catches up on its next task. The model stays as it was spawned, because a workflow or the parent may have chosen it. If the agent file is gone, the child keeps its spawn-time tools and the send result says so. A message the user types into a child does not refresh it.

## Restarts

Children live in the parent's Durable storage, and they run only while the daemon has the parent session open. At startup, the daemon discovers unfinished work from saved Durable journals and reopens its parent without a browser request. It also repairs unfinished child-run records. `$PI_WEB_DATA_DIR/durable-children-live.json` remains an index for worktree protection, not the recovery authority. A missing index does not prevent child recovery. A tool call that was interrupted reruns only when the tool is replay-safe; otherwise the child is told that the call was interrupted. See [startup recovery](deployment.md#update-an-existing-checkout) for costs and diagnostics.

## Limits

- Children share the parent's working folder unless spawn sets `isolation: "worktree"`.
- Shared tools run in the parent session's working folder even when the child uses `isolation: "worktree"`. They keep the parent extension's execution context. For example, the bundled `process` tool and `workspace_services` act on the parent checkout. Worktree isolation applies to child-native coding tools, not shared session tools.
- Children never share `child_agent`, `ask_user`, `end_turn`, `spawn_session`, `handoff_session`, `workflow_finish`, `workflow_stop`, `propose_workflow`, any `propose_*` tool, `subagent`, `bg_wait`, or `web_enable`. The parent's `grep`, `find`, and `ls` are also excluded; agent files translate these names to child-native `bash`. Tools with `model-only` or `hidden` exposure are also excluded.
- `childToolsDeny` denies more shared session tool names (default `[]`). It does not remove child-native tools and is not a shell or filesystem sandbox.
- Worktree isolation starts at the parent's committed `HEAD`. It does not copy uncommitted parent files.
- Landing targets the repository's default branch. It can also land commits inherited from an unlanded parent branch. The `ahead` summary counts only commits after the parent's starting `HEAD`.
- Landed and discarded children keep their Durable transcript, but cannot accept new work. Spawn another child.
- A session-owned parent worktree cannot land or discard while it owns active child worktrees.
- A child is not a Forgerie session: it has no catalog entry, title, archive, or pin.
- Each child report gives the parent model a turn, which costs parent tokens.
- pi-subagents still loads beside this feature. Its `subagent` tool is unchanged.

## API

Browser requests use `/api` before the paths below. Sessiond uses the paths without `/api`. `:id` is the parent session ID; `:child` is its positive integer Durable conversation ID. Session-specific requests identify the parent's `cwd`, not the child's worktree path. The daemon-wide run-history read does not require `cwd`.

### Tool

`child_agent` accepts this object:

```ts
{
  action: "spawn" | "send";
  name: string;
  message: string;
  agent?: string; // Spawn only. Agent-file name.
  isolation?: "shared" | "worktree"; // Spawn only. Default shared.
}
```

`worktree` allocates under `<main-checkout>/.worktrees/` at the parent's `HEAD`. The allocation receipt, path, and branch are deterministic for the Durable tool task. Restart replay reuses that receipt and original starting commit. Each child conversation saves its own `cwd`.

A successful tool result contains `content: [{type: "text", text: string}]` and `details: {name: string, conversationId: number}`. A worktree child adds its branch, commits ahead, and at most 20 changed paths to its completion report. Changed paths include committed changes, staged changes, unstaged changes, and untracked files. Reports still start a parent turn.

### Reads and existing actions

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /sessions/:id/children` | Query `cwd` | `DurableChildSummary[]`, defined below. |
| `GET /sessions/:id/children/:child/messages` | Query `cwd` | `{messages: ModelMessage[], busy: boolean, partial?: AssistantMessage}` using Pi message shapes. |
| `POST /sessions/:id/children/:child/message` | `{cwd: string, text: string}` | `{ok: true}`. Steers a busy child or starts new work in an idle child. |
| `POST /sessions/:id/children/:child/stop` | `{cwd: string}` | `{ok: true}`. |
| `POST /sessions/:id/children/questions/answer` | `{cwd: string, questionId: string, answer: string}` | `{ok: true}`. |

```ts
interface DurableChildSummary {
  name: string;
  conversationId: number;
  agent: string | null;
  busy: boolean;
  createdAt: number; // Unix milliseconds.
  questions: {questionId: string; question: string; askedAt: number}[];
  worktree?: {
    path: string;
    branch: string;
    repo?: string;
    defaultBranch?: string;
    cleanup?: Cleanup;
    cleanupRetryToken?: string; // A previous confirmed discard whose cleanup is incomplete.
    statusError?: string; // Git status is unknown; never treat this as clean.
    state: "active" | "landed" | "discarded";
    ahead: number; // Nonnegative integer, relative to the starting parent HEAD.
    dirty: boolean;
  };
}
```

Shared children omit `worktree`. Removed worktrees report `ahead: 0` and `dirty: false`; these are terminal receipt values, not a Git status check. A failed status check on an active checkout sets `statusError`, so other children stay visible. The browser refuses to treat its zero fallback count as readiness.

### Review and continuation

`GET /sessions/:id/children/:child/worktree/changes?cwd=...` returns `{head: string, sections: {label: string, diff: string, truncated: boolean}[], untracked: string[]}`. Sections separate committed changes relative to the default branch, staged changes, and unstaged changes. This includes inherited unlanded parent commits. Each displayed diff is capped at 512 Ki characters. Git output above 4 MiB fails the read. Untracked paths are listed without opening their contents or following symlinks. This is a read, not a frozen approval of later Git changes.

`POST /sessions/:id/children/:child/continue` takes exactly `{cwd: string, text: string, requestId: string}`. Text must contain 1 to 65536 characters and cannot be blank. The request ID contains 1 to 128 letters, digits, or hyphens. It returns `{conversationId: number}`. Only a landed or discarded child can use this operation. The new child starts from the current default-branch commit, keeps the original agent settings, and gets a fresh conversation. Its name gains a numeric suffix. The old child's conversation and receipt stay unchanged.

Repeating the same continuation request ID and text returns the same child, including after restart. Reusing that ID for a different source child or task returns 409. Allocation uses a deterministic worktree receipt. A failed setup stays available for the same request to retry.

These operations return 400 for malformed input, 404 for a foreign child or unknown parent, and 409 for lifecycle or Git refusal. Errors have shape `{error: string}`.

### Worktree actions

| Method and path | Strict request body | Response |
| --- | --- | --- |
| `POST /sessions/:id/children/:child/worktree/land` | `{cwd: string}` | `WorktreeActionResult`. |
| `POST /sessions/:id/children/:child/worktree/discard-preview` | `{cwd: string}` | `WorktreeDiscardPreview`. |
| `POST /sessions/:id/children/:child/worktree/discard` | `{cwd: string, confirmationToken: string}` | `WorktreeActionResult`. Token length is 1 to 1024 characters. |

Extra body fields are invalid. Worktree actions refuse a working child, a pending child submission, or an undelivered completion report. New child submissions and worktree actions share an admission lock. The existing ownership, rebase, dirty-file, hook, and removal checks also apply. All Git lifecycle mutations serialize per repository. In production, the owning parent's managed processes and other working agents must also stop before removal.

Land rebases onto the default branch and fast-forwards that branch. It refuses uncommitted child files. Discard preview lists the commits and dirty files it would delete. Discard requires the exact preview token. If those files or branch tips change, discard returns `stale-preview` and deletes nothing. Confirmed discard can delete uncommitted work. These child actions are explicit. The separate cleanup job described below removes only unused, clean, merged owned checkouts.

```ts
type Cleanup = {kind: "pending"} | {kind: "done"} | {kind: "failed"; error: string};
type WorktreeActionResult =
  | {kind: "landed"; sha: string; cleanup: Cleanup}
  | {kind: "discarded"; cleanup: Cleanup}
  | {kind: "conflict"; files: string[]; defaultBranch: string; prompt: string}
  | {kind: "blocked"; reason: string; files: string[]}
  | {kind: "stale-preview"};
interface WorktreeDiscardPreview {
  worktreeId: string;
  branch: string;
  defaultBranch: string;
  commits: {sha: string; subject: string}[];
  dirtyFiles: string[];
  confirmationToken: string;
}
```

Domain results return HTTP 200, including `blocked`, `conflict`, and `stale-preview`. Callers must check `kind` and `cleanup.kind`. Invalid input returns 400; an unknown session, a foreign child, or a session without child support returns 404. Worktree ownership, busy, and lifecycle errors return 409. Errors have shape `{error: string}`. The existing non-worktree routes retain their error mapping; unexpected failures return 500.

### Cleanup API

New worktrees use `.worktrees/`. Existing `.worktree/` checkouts stay at their recorded paths. These endpoints report only the job's owned-worktree inventory. Unowned worktrees are untouched.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /sessions/worktrees/cleanup` | No body or query is required. This read starts no cleanup. | `CleanupState`, below. |
| `POST /sessions/worktrees/cleanup` | No body, or `{}`. Extra fields and non-object bodies are invalid. | `CleanupReport`. Concurrent calls share one job run. |

```ts
type KeptReason = "dirty" | "unmerged" | "in-use" | "setup-incomplete" | "checkout-changed" | "error";
interface CheckoutIdentity { id: string; repo: string; path: string; branch: string }
interface CleanupReport {
  startedAt: string; // ISO UTC timestamp.
  finishedAt: string; // ISO UTC timestamp.
  kept: (CheckoutIdentity & {reason: KeptReason; detail?: string})[];
  removed: CheckoutIdentity[];
}
type CleanupState =
  | {phase: "never-run"}
  | {phase: "running"; previous?: CleanupReport}
  | {phase: "done"; report: CleanupReport}
  | {phase: "failed"; error: string; previous?: CleanupReport};
```

The snapshot is the last report, not a new filesystem scan. Reports live in sessiond memory; restart runs the job again. Records whose cleanup is already done do not appear in a later run.

A job run returns HTTP 200 even when it keeps every checkout. Each kept entry states the reason. Per-checkout failures use `reason: "error"` and `detail`; they do not stop inspection of other records. Invalid input returns 400. An inventory-wide or shutdown failure returns 500. Errors have shape `{error: string}`. There is no force or discard setting.

Sessiond also runs the job at startup after child recovery and every five minutes. It keeps idle unarchived sessions and their child worktrees. Automatic cleanup counts ignored files as dirty, so dependency folders can prevent removal. See [Automatic cleanup](session-worktrees.md#automatic-cleanup) for the safety rules and costs.

### Run history API

`GET /sessions/children/runs` accepts the optional query fields `session` and `agent`. Both are exact, nonempty strings. `agent` matches the agent-file name, not the child's name. Omit both to read all retained records. Combined filters must both match. Empty, repeated, and extra fields return HTTP 400. This read does not open a session or resume work.

HTTP 200 returns `{retentionDays: 90, records: ChildRun[]}`. Records sort by `startedAt` descending, then `id` ascending. Read failures return HTTP 500 with `{error: string}`.

```ts
interface Usage {
  input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number;
  reasoning?: number; cacheWrite1h?: number;
  cost: {input: number; output: number; cacheRead: number; cacheWrite: number; total: number};
}
interface ChildRun {
  id: string; // Stable across restart and replay.
  workflowRunId?: string; // The active prose workflow when this child run began.
  session: {id: string; cwd: string};
  child: {
    name: string; conversationId: number; agent: string | null;
    agentFile?: {path: string; sha256: string};
  };
  model: {provider: string; modelId: string} | null;
  startedAt: number; // Unix milliseconds, from initial input placement.
  state:
    | {kind: "running"}
    | {kind: "finished"; outcome: "answered" | "failed" | "stopped";
       finishedAt: number; durationMs: number; timing: "observed" | "recovered"};
  turns: number;
  usage: {models: Record<string, Usage>; tools: Record<string, Usage>} | null;
}
```

`workflowRunId` links a child run to the active prose workflow at its initial input boundary. It stays fixed through steers and restarts. It is absent for work that began outside a workflow. Workflow routes and exact request shapes are documented in [Saved prose workflows](workflows.md#http-api).

One record follows one Durable `pi.live.run`, not the child's entire conversation. A steer joins the current record. An idle input or a queued follow-up starts another record when Durable places it. Inputs placed together share a record. A general helper has `agent: null` and no `agentFile`. Existing children without saved file provenance also omit `agentFile`. The hash covers the original file bytes selected at spawn. Editing that file later does not change a running child's instructions or recorded hash.

`model` is null until a generation chooses a model. `turns` counts distinct started Durable generation tasks. Tool rounds add generations; retries and restart replay of the same task do not. Duration includes pauses and time waiting for a human. `observed` timing comes from the completion commit. `recovered` means completion was rebuilt after restart, using the task receipt's end time when available and the recovery observation time otherwise.

Usage is the committed change in the child's own `pi.usage` between run boundaries. Model keys are `provider/modelId`; tool buckets retain their tool names. Parent spending and work committed outside an active run are excluded. Costs are SDK estimates, not a billing statement. Zero configured prices do not establish a free request. Uncommitted provider work is not in the Durable ledger. A missing accounting boundary returns `usage: null`, not zero.

Records live in `$PI_WEB_DATA_DIR/child-runs.json`, with private recovery checkpoints and atomic file replacement. Child generation and compaction requests wait for pending record writes. This adds disk I/O before requests. A write failure is reported and blocks a new child request rather than spending without a saved accounting boundary. Startup also reopens parents with unfinished records, even if the live-child index no longer lists them. A read alone never starts that recovery.

Completed records expire 90 days after `finishedAt`. Unfinished records remain. Sessiond prunes on startup, reads, writes, and a daily timer. Expiry removes only history metadata. It does not delete conversations, transcripts, branches, or worktree files. Invalid history files fail rather than being reset or overwritten. Records are new metadata, not a complete backfill of historical child runs.

## Verification

`durableChildSessionTools.test.ts` uses the production Durable session with registered extension tools. It checks named-tool selection, exclusions, missing-tool reports, validation, extension hooks, separate call IDs, late registration, and replacement registries after reload.

The opt-in real-model check keeps a temporary profile install of `npm:pi-web-access@0.39.0` so it also works on builds without bundled pi-web-access. When Forgerie bundles pi-web-access, it ignores this profile copy with a warning and uses the bundled tools instead. The bundled `researcher` calls `web_search` and `fetch_content` once each. The check removes every provider-key environment variable using the same filter as `web-access-real.ts`, records extension-hook timings, and removes its copied model credentials and temporary workspace on exit. It never opens the live daemon. Model calls incur costs.

```bash
RESEARCH_REAL=1 RESEARCH_MODEL=<model-id> \
  RESEARCH_CREDENTIAL_FILE=<private-json-with-baseUrl-and-apiKey> \
  ./scripts/child-tools-real.ts
```

A SIGKILL cannot run cleanup. If that happens, remove `/tmp/forgerie-child-tools-real-*/agent/models.json` for the interrupted check.

## Code

- Server: `src/server/sessions/durableChildAgents.ts`, `durableChildHost.ts`, `durableChildProfiles.ts`, `durableChildRoutes.ts`.
- Run history: `src/shared/childRuns.ts`, `src/server/sessions/durableChildRunRecords.ts`, `childRunStore.ts`, `childRunRoutes.ts`.
- Browser: `ui/src/childAgents/`.
- Spike and findings: `prototypes/durable-child-spike/README.md`.
