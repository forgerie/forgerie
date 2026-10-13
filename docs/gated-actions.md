# Gated actions

Forgerie blocks recognised irreversible and external tool calls through shared Durable gate admission. Direct calls enter through `ToolTask.beforeTool`; nested `ctx.executeTool` calls, including codemode and shared child tools, enter through the Durable SDK adapter. The parent and every newly spawned, refreshed or continued Durable child select the hook. The agent receives a blocked result at once and can keep working on other parts. A waiting gate counts toward **Needs your response** and the dock wait. Prompt guidance also covers actions hidden inside scripts.

## Default categories

All six categories are gated. `src/shared/autonomyPolicy.ts` owns their schema, labels and defaults. The injectable `AutonomyPolicySource.read(cwd)` returns defaults in this slice. Version 1 already includes `autoPassStops: false`; configurable policy storage comes in slice 4.

| Category | Recognised actions |
| --- | --- |
| `force-push` | Force flags, positive forced refspecs, pushes to the default branch, all-branch and mirror pushes. Unknown repository state gates a push. |
| `destroy-local` | Hard reset; clean except preview; checkout/restore of dirty paths; forced or dirty worktree removal; forced deletion of an unmerged branch. Unreadable dirty/merge state gates. |
| `delete-remote` | Push deletion flags or deletion refspecs; GitHub release delete; GitHub API DELETE. |
| `github-merge-close` | `github_write` merge/close; `gh pr merge/close`; issue close unless GitHub confirms `agent-filed`. The issue lookup uses the GitHub client. Lookup failure and pull requests gate. |
| `publish` | npm publish, including `--dry-run`; GitHub release create. |
| `messages` | Tool names ending in `ebay_seller_update`, `ebay_seller_offer_respond` or `ebay_seller_message_reply`, including prefixed MCP names. |

`npm publish --dry-run` stays gated. This avoids relying on npm/plugin/version-specific side effects. Its cost is an approval for a preview. ADR 0003 says `git clean`, broader than the contract's `git clean -f`: interactive and other non-preview clean calls also gate. `git clean -n` and `--dry-run` remain read-only previews.

The quote-aware shell classifier splits command sequences, pipelines and newlines. It recognises shell `-c` one level deep, `cd`, Git `-C`, common command wrappers, Git/GitHub flags in either order, and shell heredoc bodies one level deep. Plain heredoc bodies are data: `cat <<EOF` with the text `git push -f` does not gate. Custom Git directory, worktree or config overrides make state-dependent checks unknown rather than checking the wrong repository. Unknown state is not permission. The classifier receives read-only Git and issue-label observations. Production Git observations disable optional index locks.

This is recognition, not a shell sandbox. Aliases, substitutions, functions, indirect commands, nested shells deeper than one level, and shell scripts are not comprehensively inspected. Calls made through codemode `tools.*` are inspected individually, even if the script calculates their arguments. Deploy targets, email tools and paid jobs without one of the recognised tool names are not detected in this slice. An omitted or hidden action can still run. The agent must follow the guidance for these actions.

## Approval, refusal and restart

Approval applies to one saved tool call and its saved arguments. A nested waiting gate resolves to the same blocked text as a direct gate; it does not reject the script promise. A waiting result is not proof that the action ran. The script can keep doing independent work. Deferred/codemode-only tools use a private SDK execution registration for approval, never a new direct model declaration. It admits a background Durable task in the calling conversation. The task uses that conversation's tool registry and environment. Successful tool results retain output, details and diagnostics. Reported tool usage enters the originating conversation's existing `pi.usage` ledger in the result commit. Shared extension tools still use their parent's extension context, as before. A changed conversation cwd or an unavailable tool fails rather than running in a different cwd. Plugin reloads and environment changes are not snapshotted; keep those stable while a gate waits.

The server first commits `approved` and the run task together. The run task then commits an execution-intent checkpoint **before** it invokes the tool. Only that invocation can run it. Restart before intent can run the approved action. Restart after intent records `failed` with **Unknown outcome**, never runs it again, and tells the agent to check the effects. A crash between intent and execution can therefore leave an action that never ran. This is at-most-once execution, not a claim of exactly-once external effects.

Result storage and the placement-tracked result outbox commit together. A live child receives a follow-up. If it has finished or is missing before admission, the parent receives it. Queued delivery is not counted as placement. Withdrawn unplaced inputs retry with fresh receipts and select a live recipient again. Already placed inputs do not repeat. Refusal never runs the tool and delivers `The user refused gate <id>: <description>.` Approval and refusal each record one `gated` decision by `user`, inside the same commit as admission/refusal.

Gate identity uses the Durable conversation and tool-task IDs, not the model's call ID. Nested gates also use an invocation-local ordinal; different nested calls and repeated model call IDs cannot share an approval. The SDK adapter keeps the calling conversation and task context until the source call finishes, then removes it. Calls without a live Durable invocation fail closed. Replay after gate admission reuses the gate and its transcript entry. A new call needs a new approval.

## HTTP API and wire schemas

Browser requests add `/api` (and, for machine routing, `/machines/:machine`). Sessiond uses the paths below. The existing session wildcard proxy forwards these paths and errors unchanged. `cwd` identifies the parent session, not a child worktree.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /sessions/:id/gated-actions` | Only query `cwd`. | `GatedAction[]`, newest first. Non-Durable sessions return `[]`. |
| `POST /sessions/:id/gated-actions/:gid/approve` | Exactly `{cwd}`. | `GatedAction` with `state.kind: "approved"`. Execution and delivery continue in the background; refetch on `workflow_runs_changed`. |
| `POST /sessions/:id/gated-actions/:gid/refuse` | Exactly `{cwd}`. | `GatedAction` with `state.kind: "refused"`. |

Invalid input returns 400, missing gate/session 404, and a non-waiting gate 409. Errors have shape `{error: string}`. Admission and terminal record changes emit `workflow_runs_changed`. Waiting gates add to `waitingOnYou`, separate from non-blocking flagged decisions.

`src/shared/gatedActions.ts` exports `GatedAction`, `GatedActionState`, `GatedActionEntry`, and their TypeBox schemas. `GatedAction` is `{id, conversationId, by, tool, args, category, description, requestedAt, state}`. `by` is `parent` or `child <name>` (conversation ID fallback). State is `{kind: "waiting"|"approved"|"refused"}` or `{kind: "ran", result, at}` or `{kind: "failed", error, at}`. `result` is the JSON tool result, not just text. Times are Unix milliseconds. The Durable document kind is `forgerie.gated-actions`.

Transcript kind `forgerie.gated-action` has `{id, by, tool, category, description, command}`. `command` is a preview limited to 4000 characters; the saved `args` are not truncated. The entry is for the reader, not extra model input. `src/shared/autonomyPolicy.ts` exports `GatedCategory`, `AutonomyPolicy`, and `AutonomyPolicySource`.

## Verification

`gatedActions.test.ts` covers more than 40 gated and allowed commands, state observations, wrappers, flag order, previews and heredocs. `durableGatedActions.test.ts` runs real Durable journals: parent and child hooks, replay admission, approval/refusal, live-child versus parent delivery, policy injection, ordering, and crashes before/after execution intent and after an effect. `gatedNestedActions.test.ts` runs real codemode scripts for force-push, deferred eBay tools and allowed commands. It checks script continuation, child attribution, exact-once approval, refusal and restart. `gatedActionRoutes.test.ts` calls the production service through Fastify and runs a real push to a scratch bare remote. Proxy tests cover unchanged requests and 409 errors.

`GATED_ACTIONS_REAL=1 ./scripts/gated-actions-real.ts` uses a real model in a temporary profile. It asks for a force-push to a scratch bare remote with a divergent tip. The call must block. The agent must write an independent progress file before HTTP approval. A pre-push hook counts exactly one invocation; the script also checks the remote commit and the agent's result report. It removes copied credentials and scratch files on exit. Add `GATED_ACTIONS_NESTED=1` to run the force-push and independent step inside one codemode script; it checks the same gate and once-only execution path. Model calls incur costs. SIGKILL cannot run cleanup: remove `/tmp/forgerie-gated-actions-real-*/agent/models.json` after an interrupted check.
