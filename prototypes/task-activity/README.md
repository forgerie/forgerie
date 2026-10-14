# Task activity in the status panel

A mockup that shows a session's live Durable tasks in the status chip's panel.
Forgerie already watches `harness.watchTaskGraph()`, but only to count working
children. The browser never sees the graph. This mockup shows what it could
show.

Open `board.html` to see every scene at the Fold 8 folded portrait and unfolded
landscape viewports. Open `index.html?scene=<name>` for one scene at the window
size. Run `./render.sh dark` or `./render.sh light` to capture all four
postures into `shots/` (ignored by git).

| Scene | What it shows |
|---|---|
| `working` | The chip, closed. Background agents ride along as a quiet count. |
| `working-open` | This turn's tasks, the background agents, and what a restart would do. |
| `working-details` | One row opened: the task's kind, ID, owner, start time, and scheduler state. |
| `idle-background-open` | Pi finished, but two agents still work. |
| `stuck-open` | A task that cannot run after a rollback, and how to stop it. |

## Where each field comes from

| On screen | pi-durable source |
|---|---|
| The tree | `TaskGraphNode.owner`, and the anchor's `conversations` for child agents |
| Running, waiting, finishing | `TaskGraphNode.state.status` |
| Cannot run | `harness.inspect()`, `state.kind === "blocked"` with its `reason` |
| Elapsed time | `TaskRecord.startedAt` (pi-durable 1.1.0) |
| Stops if Forgerie restarts | The tool's replay policy in `durableSdkTools.ts` (`unsafe`) |
| Stop the task | `harness.abortTask()`. A blocked task settles as `orphaned`. |

## Rules the mockup follows

- Rows use Forgerie's words. The task kind sits behind the row, never on it.
- A restart warning appears only on rows where a restart changes the outcome.
  The panel says once that everything else resumes.
- The panel lists live tasks only, because the graph does. Finished tasks stay
  in the chat, as today.
- A short pane drops the state lede first. The lists below say the same thing.
- Stop appears only where it maps to an outcome the user can understand. A
  running turn keeps the existing Stop button.
