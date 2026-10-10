# Saved prose workflows

A workflow is a prompt file with declared inputs and a saved record of each launch. You can copy a workflow, change its prose, and compare the resulting runs. Forgerie does not prescribe models, a sequence, review rounds, or human check-ins.

This first path requires `durableChildren`. Enable it in the Forgerie config and restart sessiond when no agents are running. pi-subagents remains installed beside Durable children.

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
Ask the user only when a decision blocks progress.
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

## File and input rules

Workflow discovery reads `<cwd>/.pi/prompts/*.md`, then `<agentDir>/prompts/*.md`. The first file with a name wins. On this host, `agentDir` is `~/.local/share/forgerie/agent`. An invalid project override blocks the profile file rather than falling back silently. Package-contributed and extra configured prompt folders are not workflow sources in this first path.

A workflow keeps the normal prompt format. Add `workflow: {version: 1}` for a workflow without inputs. Other prompt frontmatter remains intact. Inside `workflow`, only `version` and `inputs` are supported. Names use the prompt library's lowercase letters, digits, and dashes, with at most 64 characters.

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

Legacy pi-subagents runs are not linked to workflow records. Use `child_agent` for tracked delegation. Child questions still do not start parent turns; each normal completion report still does. If a reporter terminates without delivering, the record exposes `deliveryError`. It does not claim delivery, and explicit completion remains possible after all child work settles.

If the coordinator forgets to finish, the run stays active. Stop ongoing work before using the finish HTTP route to record a failed or stopped run. Finishing changes metadata; it does not cancel work.

## Restarts, retention, and cost

The workflow record and its launch task live in the parent's Durable SQLite storage. Launch delivery uses a stable submission request ID. Retrying the same launch keeps its original bytes and inputs, even after the source changes. Reusing a launch request ID with different inputs or another name is refused.

Unfinished workflows keep the parent in the daemon's recovery index, including idle pauses. Startup reopens that parent without starting a new model turn merely to read its record. The existing recovery-index and storage ownership rules still apply.

Completed workflow records expire 90 days after completion when their history is read. Unfinished records remain. Small launch receipts remain to refuse reuse of expired IDs. Expiry does not delete transcripts, task receipts, branch files, or prompt files. This is metadata retention, not deletion of the delivered instructions from conversation history.

Workflow history currently opens the parent runtime. This route does not read records from completed, read-only managed parent worktrees. The separate child-run history remains available through its global store.

Runs in the same chat share its existing context. Prose remains model-directed; neither sequence nor fair experimental conditions are guaranteed. The record saves results and links to child accounting, but it does not calculate total workflow cost or parent spending. Existing child costs are SDK estimates, not bills.

## HTTP API

Browser URLs use `/api` before these paths. Requests identify the parent's `cwd`. Save and copy complete file text through the existing `POST /prompts` endpoint. Existing resource routes edit that text with revision checks.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /sessions/:id/workflows` | Only query `cwd`. | `{workflows: ProseWorkflow[], diagnostics: {name, path, error}[]}`. Each definition includes `name`, `path`, `sha256`, exact `text`, stripped `body`, and parsed `definition`. |
| `POST /sessions/:id/workflow-runs` | Exactly `{cwd, name, inputs, requestId}`. | A `WorkflowRun` after its record and delivery task commit. This is admission, not proof the model completed. |
| `GET /sessions/:id/workflow-runs` | Only query `cwd`. | `WorkflowRun[]`, newest first. |
| `POST /sessions/:id/workflow-runs/:runId/finish` | Exactly `{cwd, outcome, result}`. | `{ok: true}`. This is a human recovery operation with the same settlement checks as the coordinator tool. |

`requestId` contains 1 to 128 letters, digits, or hyphens. Use a new ID for an intentional rerun. An expired receipt cannot be reused. Results must contain 1 to 65536 characters and cannot be blank.

`WorkflowRun` is defined once in `src/shared/workflowRuns.ts`. It contains the session, launch ID, request ID, start time, definition snapshot, resolved inputs, explicit run state, and child requests. Each child request identifies its conversation and reporter, with working or settled state. Settled state contains its outcome, result, delivery flag, and optional delivery error. Child requests are not unique child conversations; multiple sends can share one child's answer.

Invalid requests and input definitions return 400. Missing workflows and foreign run IDs return 404. Active work, script files, conflicting request IDs, and conflicting completions return 409. Unexpected filesystem or storage failures return 500. Errors have shape `{error: string}`. No route accepts an arbitrary workflow path.

## Verification

`src/server/resources/workflowLibrary.test.ts` checks discovery, precedence, input validation, exact text, and script refusal. `src/server/sessions/workflowRuns.test.ts` uses temporary files, real HTTP handlers, the production Durable factory, and a configured scripted provider. It checks file effects, restart recovery, launch retries, frozen provenance, explicit completion, copied variations, parallel children, stopped and failed results, and retention. These tests do not establish real-model or physical-device acceptance.

The opt-in `scripts/workflow-real.ts` check uses a real CLIProxyAPI model. It saves and launches a workflow, checks the child's file output, copies a variation, and checks explicit completion and both child-run links. It owns a temporary profile and workspace. It copies the live CLIProxyAPI credential into a private temporary file and removes that file on normal exit or SIGTERM. It does not restart the live daemon. Model calls incur provider costs.

```bash
WORKFLOW_REAL=1 ./scripts/workflow-real.ts
```

Set `WORKFLOW_MODEL` to change the model. Set `WORKFLOW_SERVE=1` to keep the isolated HTTP server on `127.0.0.1:8544` for browser acceptance, then stop it with SIGTERM. If it is killed with SIGKILL, remove the temporary `agent/models.json` credential file yourself.
