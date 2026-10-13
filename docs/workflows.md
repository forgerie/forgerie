# Prose workflows

A saved workflow is a prompt file with declared inputs and a saved record of each launch. A temporary workflow proposal keeps its instructions in the session instead of a file. You can copy a workflow, change its prose, and compare the resulting runs. A workflow can also declare its route: stages in order, the workers each stage expects, and stops where you decide. Forgerie enforces only the stops. The agent decides how to run the stages between them.

This path requires `durableChildren`, which is on by default.

## Save and run

Save a file with `/prompt-new experiment`, followed by this complete text. You can also create the file with an agent or edit an existing prompt in Resources.

```yaml
---
description: Implement and review a task
workflow:
  version: 1
  inputs:
    task:
      type: string
    review:
      type: boolean
      default: true
    rounds:
      type: number
      choices: [1, 2, 3]
      default: 2
---
Use the task input as the brief. Choose the workers that fit the task.
Delegate independent work with child_agent. If review is true, send the
combined result to a fresh reviewer. Use at most the specified rounds.
Answer child questions from the task, contract, code, docs and chat.
Ask the user only for an irreversible or external escalation. Record a
provisional guess for a contradicts or stuck escalation and keep working.
```

Launch it from the chat:

```text
/workflow-run experiment {"task":"Add export support"}
```

The parent must be idle, with no pending child work or reports. One workflow can remain active in a session. The launch freezes the file text, its SHA-256 hash, its path, and the resolved inputs. Editing the file does not change that run.

Use `/workflow-runs` to read this session's records. To try a variation:

```text
/workflow-copy experiment experiment-review-first
```

The copy goes into the profile's prompt folder. It never overwrites an existing file. Edit the copy in Resources, then launch it with `/workflow-run`. Disk reads make changes available without `/reload`.

## Start from the browser

The workflow button in the session header lists the saved workflows. A file that cannot be read is listed with the reason. Choose one to see its plan: its description, its inputs, and its route with the stops marked. The task field starts with the composer's text, if any. **Start workflow** launches it. Starting needs an idle session with no other workflow running.

While the run is active, a strip above the composer shows its stages as bars. Parallel workers are stacked bars, and a count shows stops that wait on you. Press the strip to see the live route. Each started worker opens its child.

## Temporary workflow proposals

For a task that needs several workers, a review, or your check, the agent can call `propose_workflow({name, summary, text, inputs?})`, then end its turn. Small tasks do not need a proposal. A one-off workflow must not become a file in the repository. The tool guidance says: “Add no approve stops unless the user asked to check something. Only irreversible steps need a stop.”

The **Proposed workflow** card shows the name, overview, stages, workers, and stops. An open proposal counts as **Needs your response**. Review it and change the pre-filled inputs before choosing:

| Action | Result |
| --- | --- |
| **Start workflow** | Starts from the proposal's frozen instructions and your inputs. The proposal closes as **Started**. Another active workflow or a busy parent blocks Start with a reason. |
| **Ask for changes** | Requires a note. Closes the proposal and delivers the note to the agent once. The agent revises and proposes again. |
| **Dismiss** | Closes the proposal without waking the agent. |

A new proposal closes every earlier open proposal as **Replaced**. The tool validates the same frontmatter, prose, route, and inputs as a saved workflow. It refuses scripted workflows and proposals during an active run. Only the user starts the run.

The proposal lives in a Durable document. Start records the run and the proposal's decision in one commit. The run's source path is `proposal:<proposalId>`, not a filesystem path. Retrying Start with the same request ID and inputs returns the accepted run. No prompt file is read or written. There is no action to save a proposal to the library or edit its text in the browser. Proposal records have no automatic expiry; they remain in the session's storage and add to its size. Reopening a session restores its open proposals and waiting count without a model turn. Startup recovery currently selects unfinished runs, not idle sessions that have only an open proposal.

## Stages and stops

Declare the route in the same `workflow` frontmatter:

```yaml
workflow:
  version: 1
  inputs:
    task: { type: string }
  stages:
    - { id: contract, name: Contract, does: "This chat writes the contract. You approve it.", stop: approve }
    - id: build
      name: Design and build
      workers:
        - { name: design, agent: design-engineer, model: anthropic/claude-opus-5.5 }
        - { name: build, agent: full-stack-engineer }
    - { id: review, name: Review, workers: [{ name: review, agent: reviewer }] }
    - { id: land, name: Land, stop: land }
```

A stage with `stop` names you as its actor. `approve` asks you to approve what the agent prepared. `land` lands the run's child branches. A stop stage declares no workers. A land stage must be the last stage. Stage ids and worker names use lowercase letters, digits, and dashes. A worker name appears in one stage only. A worker's `model` is `provider/model-id`, optionally with `:thinking-level`. When the agent spawns a child with a declared worker's name, Forgerie uses that model, whatever model the agent asked for and whatever the agent file says. Without a declared model, the agent file's model applies. `child_agent` also accepts `model` for one spawn of an undeclared child.

Forgerie enforces three rules:

- `child_agent` refuses a spawn or a send for work after the first stop you have not approved. A declared worker belongs to its own stage. Any other child belongs to the last agent stage before that stop.
- The agent asks with `workflow_stop` (run id, stage id, summary) and ends its turn. The run holds there. The chat shows a card with the summary.
- A run finishes as `completed` only after every stop. It can finish as `failed` or `stopped` at any time.

At an approve stop, the card offers **Approve** and **Ask for changes**. Asking for changes sends your note to the agent, which revises and asks again. Each round gets its own card; older cards close. At a land stop, **Land all** lands each child branch with commits, in the order the children started. Each branch rebases onto the default branch first. A conflict or a block stops the landing, keeps the branches that landed, and leaves the stop waiting. Your decision reaches the agent once, as a new message.

Forgerie draws agent stages from their children, so the drawing can drift from what the agent did. Forgerie does not stop the agent from landing, merging, or pushing with its own shell tools. The launch prompt tells it not to.

## File and input rules

Workflow discovery reads `<cwd>/.pi/prompts/*.md`, then `<agentDir>/prompts/*.md`. The first file with a name wins. On this host, `agentDir` is `~/.local/share/forgerie/agent`. An invalid project override blocks the profile file rather than falling back silently. Package-contributed and extra configured prompt folders are not workflow sources in this first path.

A workflow keeps the normal prompt format. Add `workflow: {version: 1}` for a workflow without inputs. Other prompt frontmatter remains intact. Inside `workflow`, `version`, `inputs`, and `stages` are supported. Names use the prompt library's lowercase letters, digits, and dashes, with at most 64 characters.

Input names start with a lowercase letter and contain letters, digits, or underscores. Each input declares `type: string`, `boolean`, or `number`. An optional `choices` list must contain that type. An optional `default` must meet the type and choices. Without a default, the input is required. Extra inputs and type coercion are rejected.

Forgerie appends resolved inputs as JSON data. It does not substitute placeholders or expand slash commands inside the workflow. Launch delivery uses a Durable input, not the SDK slash-template or input-transform pipeline.

Optional fenced `js workflow` and `javascript workflow` blocks can be saved and copied. Launch refuses these files. Script execution requires a separate runtime decision; it is not silently skipped.

## Explicit completion

An idle parent does not finish a workflow. The coordinator calls this general tool after associated work and reports settle:

```ts
workflow_finish({
  runId: "<launch ID>",
  outcome: "completed", // Or "failed" or "stopped".
  result: "What was completed, and what remains."
})
```

The tool records a final result. Repeating the same completion is safe. A different outcome or result is refused. The tool does not stop the model, land branches, discard worktrees, or waive normal cleanup checks.

Durable child spawn, send, and fresh-child continuation requests retain their association in the same commit that creates their reporter. Their settled results stay in the workflow record. Each child run started while the workflow is active also saves `workflowRunId` in the existing child-run history. A steer joins its current child run. A new idle input creates another child run.

Transient provider failures keep the associated child request working through the reporter's three retries (30 seconds, 2 minutes, 5 minutes). Each retry has a new input receipt and child-run history record. Only success or exhausted retries settle the workflow child. The final failed result contains the real provider error text. See [Provider failures](child-agents.md#provider-failures).

Child questions start parent turns, as durable follow-ups. The parent answers first; only irreversible or external escalations create user question cards. Each normal completion report also starts a parent turn. Child outcomes come from the admitted Durable submission, independently of accounting or worktree reporting. A reporting failure preserves the child's actual answer, failure, or stop reason. An answer already claimed by another reporter records `delivered: "duplicate"` (“Duplicate report, not sent again”). A child stopped before reporting, a canceled reporter, or a missing reporting target records `delivered: "aborted"` (“Stopped before reporting”). Neither state is a delivery error. A delivered report records `true`; a report not yet delivered records `false`. Actual reporter failures still expose `deliveryError` and `delivered: false`. Old records with a string `deliveryError` still parse and read as `false`; Forgerie does not reinterpret their old text as a new label. Delivery means admission to the parent's inbox, not review or approval. Explicit completion remains possible after all child work settles.

If the coordinator forgets to finish, the run stays active. Stop ongoing work before using the finish HTTP route to record a failed or stopped run. Finishing changes metadata; it does not cancel work.

## Decision log

Each parent keeps a Durable decision log. A decision made while a workflow runs carries that run's `runId`. The log records parent answers to child questions, guesses in place of an escalation, automatic stops, approved or refused gated actions, and filed issues. It does not record other choices the agent judges notable. This slice implements answers and guesses; later slices add the other three kinds.

An irreversible or external child escalation waits on you and shows the parent's guess and reason in its card. A contradicts or stuck escalation gives the child a provisional guess at once. Flagged standing guesses add to `flaggedDecisions`, not `waitingOnYou`, and never pin in the dock. Overturning records a note and sends one correction to a live child, or to its parent after the child finishes. It asks the agent to redo affected work. Delivery is a follow-up, not an interruption of an executing tool. The outbox remains pending until transcript placement. A withdrawn queued input is retried with a fresh receipt, and a correction retry checks its live target again. Already placed inputs are not resent.

Read all session decisions with `GET /sessions/:id/decisions?cwd=...`; filter on `runId` for one workflow. Overturn with `POST /sessions/:id/decisions/:did/overturn {cwd, note}`. Blank notes return 400, unknown IDs 404, and already overturned decisions 409. The wire type is `Decision` in `src/shared/decisions.ts`. Decision changes emit `workflow_runs_changed`, so clients refetch runs and decisions. There is no decision expiry yet. The [child-agent API](child-agents.md#decision-log-api) describes the fields and routing.

## Restarts, retention, and cost

The workflow record and its launch task live in the parent's Durable SQLite storage. Launch delivery uses a stable submission request ID. Retrying the same launch keeps its original bytes and inputs, even after the source changes. Reusing a launch request ID with different inputs or another name is refused.

Unfinished workflows keep the parent in the daemon's recovery index, including idle pauses. Startup reopens that parent without starting a new model turn merely to read its record. The existing recovery-index and storage ownership rules still apply.

Completed workflow records expire 90 days after completion when their history is read. Unfinished records remain. Small launch receipts remain to refuse reuse of expired IDs. Expiry does not delete transcripts, task receipts, branch files, or prompt files. This is metadata retention, not deletion of the delivered instructions from conversation history.

Workflow history currently opens the parent runtime. This route does not read records from completed, read-only managed parent worktrees. The separate child-run history remains available through its global store.

Runs in the same chat share its existing context. Prose remains model-directed; neither sequence nor fair experimental conditions are guaranteed. The record saves results and links to child accounting, but it does not calculate total workflow cost or parent spending. Existing child costs are SDK estimates, not bills.

## HTTP API

Browser URLs use `/api` before these paths. Requests identify the parent's `cwd`. Save and copy complete file text through the existing `POST /prompts` endpoint. Existing resource routes edit that text with revision checks. They also provide `DELETE /resources/:resourceId` and `DELETE /sessions/:sessionId/resources/:resourceId` with `{baseRevision}` for writable prompt files. Read the resource before deletion. See [the deletion contract](resource-editor-api.md#delete-a-prompt-file) for permissions, Git effects, and failure recovery. Deletion does not remove accepted workflow snapshots.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /sessions/:id/workflows` | Only query `cwd`. | `{workflows: ProseWorkflow[], diagnostics: {name, path, error}[]}`. Each definition includes `name`, `path`, `sha256`, exact `text`, stripped `body`, and parsed `definition`. |
| `POST /sessions/:id/workflow-runs` | Exactly `{cwd, name, inputs, requestId}`. | A `WorkflowRun` after its record and delivery task commit. This is admission, not proof the model completed. |
| `GET /sessions/:id/workflow-runs` | Only query `cwd`. | `WorkflowRun[]`, newest first. |
| `POST /sessions/:id/workflow-runs/:runId/finish` | Exactly `{cwd, outcome, result}`. | `{ok: true}`. This is a human recovery operation with the same settlement checks as the coordinator tool. |
| `POST /sessions/:id/workflow-runs/:runId/stops/:stage` | `{cwd, decision, note?}`. `decision` is `approve`, `changes` (needs a note), or `land`. | The updated `WorkflowRun`. 409 when the stop is not waiting, when the decision does not fit the stop, or when a branch cannot land. |

| Proposal method and path | Request | Response |
| --- | --- | --- |
| `GET /sessions/:id/workflow-proposals` | Only query `cwd`. | `WorkflowProposal[]`, newest first. Sessions without Durable workflow hosting return `[]` (200). |
| `POST /sessions/:id/workflow-proposals/:pid/start` | Exactly `{cwd, inputs, requestId}`. | A `WorkflowRun` with the proposal's exact text and SHA-256 hash. |
| `POST /sessions/:id/workflow-proposals/:pid/changes` | Exactly `{cwd, note}`. A nonblank note, at most 8000 characters. | The closed `WorkflowProposal`; one Durable task delivers the note. |
| `POST /sessions/:id/workflow-proposals/:pid/dismiss` | Exactly `{cwd}`. | The closed `WorkflowProposal`; no agent input is delivered. |

`WorkflowProposal` is defined in `src/shared/workflowProposals.ts`. Its summary contains at most 280 characters. Decisions on a closed proposal return 409, except an identical Start retry. Foreign proposal IDs return 404. Invalid bodies and inputs return 400. A proposal document change emits `workflow_runs_changed`, like a run document change; clients read both lists again.

`requestId` contains 1 to 128 letters, digits, or hyphens. Use a new ID for an intentional rerun. An expired receipt cannot be reused. Results must contain 1 to 65536 characters and cannot be blank.

`WorkflowRun` is defined once in `src/shared/workflowRuns.ts`. It contains the session, launch ID, request ID, start time, definition snapshot, resolved inputs, explicit run state, the frozen stages, the state of each stop, and child requests with their stage. The stop rules are pure functions in `src/shared/workflowStops.ts`, shared by the server and the browser. Each child request identifies its conversation and reporter, with working or settled state. Settled state contains its outcome, result, delivery state (`true`, `"duplicate"`, `"aborted"`, or `false`), and optional delivery error for actual reporter failures or old records. Child requests are not unique child conversations; multiple sends can share one child's answer.

Invalid requests and input definitions return 400. Missing workflows and foreign run IDs return 404. Active work, script files, conflicting request IDs, and conflicting completions return 409. Unexpected filesystem or storage failures return 500. Errors have shape `{error: string}`. No route accepts an arbitrary workflow path.

## Verification

`src/server/resources/workflowLibrary.test.ts` checks discovery, precedence, input validation, exact text, and script refusal. `src/server/sessions/durableWorkflowRuns.test.ts` checks proposal replay and the single commit for Start. The HTTP tests also check proposal validation, replacement, editable inputs, blocked starts, changes delivered once, dismissal, waiting status, and reopening. `src/server/sessions/workflowRuns.test.ts` uses temporary files, real HTTP handlers, the production Durable factory, and a configured scripted provider. It checks file effects, restart recovery, launch retries, frozen provenance, explicit completion, copied variations, parallel children, stopped and failed results, and retention. A staged run checks the refused spawn before the first stop, a change request and a second round, approval, the refused early completion, and a real Git landing of the child branch. `src/shared/workflowStops.test.ts` covers the stop rules; `ui/src/workflows/` tests cover the transcript entries, the cards, and the route drawing. These tests do not establish real-model or physical-device acceptance.

The opt-in `scripts/workflow-real.ts` check uses a real CLIProxyAPI model. It saves and launches a workflow, checks the child's file output, copies a variation, and checks explicit completion and both child-run links. It owns a temporary profile and workspace. It copies the live CLIProxyAPI credential into a private temporary file and removes that file on normal exit or SIGTERM. It does not restart the live daemon. Model calls incur provider costs.

```bash
WORKFLOW_REAL=1 ./scripts/workflow-real.ts
```

`WORKFLOW_REAL=1 ./scripts/workflow-stops-real.ts` runs a staged workflow the same way, in a temporary Git workspace. It checks that the plan stop holds the child, that approval releases it, that the land stop refuses an early completion, that **Land all** lands the child's real branch, and that the agent finishes the run.

Set `WORKFLOW_MODEL` to change the model. Set `WORKFLOW_SERVE=1` to keep the isolated HTTP server on `127.0.0.1:8544` for browser acceptance, then stop it with SIGTERM. If it is killed with SIGKILL, remove the temporary `agent/models.json` credential file yourself.

`WORKFLOW_REAL=1 ./scripts/workflow-proposal-real.ts` uses a separate temporary profile, Git workspace, and in-process daemon. The real model proposes a workflow; the script starts it through the HTTP route and waits at its first stop. It verifies that `git status --porcelain` in the workspace did not change. It does not restart or deploy the live daemon. Model calls incur provider costs.

## Gated actions

Workflow parents and children use the same [gated actions](gated-actions.md). These approvals cover one irreversible or external tool call, not a whole workflow stage. Agents keep working on independent parts while a gate waits. Approvals and refusals enter the active run's decision log. Waiting gates count as **Needs your response**.
