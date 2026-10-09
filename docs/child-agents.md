# Durable child agents

Status: opt-in. Set `"durableChildren": true` in the Forgerie config, or `PI_WEB_DURABLE_CHILDREN=1`, and restart the session daemon.

A session can run background child agents inside its own Durable storage. The agent starts one with the `child_agent` tool. You do not switch sessions to follow it.

## What you can do

| Action | Where | Effect |
| --- | --- | --- |
| See every child | The robot control in the session header | Lists the session's children. Children with a question for you come first, then working ones. The badge counts open questions; a dot means a child is working. |
| Read a child | Open it from the list | Shows its task, its tool calls with folded output, and its replies as they stream. |
| Steer a child | The reply box in the open child | While it works, your message joins its run at its next tool call. When it is idle, your message is a new task. |
| Stop a child | Stop, beside the reply box | Ends the child's current work. The parent keeps running. |
| Answer a child | The question card in the parent thread, or in the open child | The answer goes to the child. The parent model gets no turn. |

The parent model sees each steer and stop as a note, so it does not undo what you told a child. Each child's final answer reaches the parent as a new message, and the parent continues from it.

Esc in the parent does not stop its children.

## Agent files

`child_agent` may name an agent file with `agent`. Forgerie reads the same files as pi-subagents, in this order: the project's `.pi/agents/`, the profile's `agents/`, then the bundled pi-subagents agents. The first file with the name wins.

Forgerie reads these frontmatter keys: `name`, `description`, `model` (with an optional `:thinking` suffix), `thinking`, `tools`, `inheritProjectContext`, and `disabled`. A file that lists `fallbackModels` is skipped. Other keys are ignored.

A child gets Durable's `read`, `write`, `edit`, and `bash` tools, plus `ask_human`. `tools` narrows them: `grep`, `find`, and `ls` map to `bash`. A child cannot start children of its own.

## Restarts

Children live in the parent's Durable storage, and they run only while the daemon has the parent session open. The daemon records sessions with live child work in `$PI_WEB_DATA_DIR/durable-children-live.json` and reopens them at startup, so a restart pauses a child and does not lose it. A tool call that was interrupted reruns only when the tool is replay-safe; otherwise the child is told that the call was interrupted.

## Limits

- Children share the parent's working folder unless spawn sets `isolation: "worktree"`.
- Worktree isolation starts at the parent's committed `HEAD`. It does not copy uncommitted parent files.
- Landing targets the repository's default branch. It can also land commits inherited from an unlanded parent branch. The `ahead` summary counts only commits after the parent's starting `HEAD`.
- Landed and discarded children keep their Durable transcript, but cannot accept new work. Spawn another child.
- A session-owned parent worktree cannot land or discard while it owns active child worktrees.
- A child is not a Forgerie session: it has no catalog entry, title, archive, or pin.
- Each child report gives the parent model a turn, which costs parent tokens.
- pi-subagents still loads beside this feature. Its `subagent` tool is unchanged.

## API

Browser requests use `/api` before the paths below. Sessiond uses the paths without `/api`. `:id` is the parent session ID; `:child` is its positive integer Durable conversation ID. Every request identifies the parent's `cwd`, not the child's worktree path.

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

`worktree` allocates under `<main-checkout>/.worktree/` at the parent's `HEAD`. The allocation receipt, path, and branch are deterministic for the Durable tool task. Restart replay reuses that receipt and original starting commit. Each child conversation saves its own `cwd`.

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
    state: "active" | "landed" | "discarded";
    ahead: number; // Nonnegative integer, relative to the starting parent HEAD.
    dirty: boolean;
  };
}
```

Shared children omit `worktree`. Removed worktrees report `ahead: 0` and `dirty: false`; these are terminal receipt values, not a Git status check. A failed status check on an active checkout fails the read rather than reporting the checkout as clean.

### Worktree actions

| Method and path | Strict request body | Response |
| --- | --- | --- |
| `POST /sessions/:id/children/:child/worktree/land` | `{cwd: string}` | `WorktreeActionResult`. |
| `POST /sessions/:id/children/:child/worktree/discard-preview` | `{cwd: string}` | `WorktreeDiscardPreview`. |
| `POST /sessions/:id/children/:child/worktree/discard` | `{cwd: string, confirmationToken: string}` | `WorktreeActionResult`. Token length is 1 to 1024 characters. |

Extra body fields are invalid. Worktree actions refuse a working child, a pending child submission, or an undelivered completion report. New child submissions and worktree actions share an admission lock. The existing ownership, rebase, dirty-file, hook, and removal checks also apply. All Git lifecycle mutations serialize per repository. In production, the owning parent's managed processes and other working agents must also stop before removal.

Land rebases onto the default branch and fast-forwards that branch. It refuses uncommitted child files. Discard preview lists the commits and dirty files it would delete. Discard requires the exact preview token. If those files or branch tips change, discard returns `stale-preview` and deletes nothing. Confirmed discard can delete uncommitted work. There is no automatic cleanup in this API.

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

## Code

- Server: `src/server/sessions/durableChildAgents.ts`, `durableChildHost.ts`, `durableChildProfiles.ts`, `durableChildRoutes.ts`.
- Browser: `ui/src/childAgents/`.
- Spike and findings: `prototypes/durable-child-spike/README.md`.
