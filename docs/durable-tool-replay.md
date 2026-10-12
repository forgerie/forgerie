# Parent tool replay

Durable 1.1.0 commits a tool's intent before execution. Recovery reruns a tool
only when both its saved intent and its current registration say `safe`.
Otherwise Durable returns an `interrupted` diagnostic to the model. Completed
results are not rerun.

Forgerie grants safety to audited read-only implementations and Durable-native
operations whose committed receipts make replay idempotent, not to a name. `DurableSdkTools.refresh()` pairs each SDK factory with its decision.
SDK extensions and custom definitions have no Durable replay contract and default
to `unsafe`. Replacing a definition removes the original implementation's safety,
including a same-name `read` or `ls` override. Reload rebuilds those decisions.

## Repository and bundled implementations

Paths below are relative to `src/server/sessions/`, unless a package is named.
The audit checked the installed source, not descriptions alone.

| Tool | Replay | Implementation reason |
| --- | --- | --- |
| SDK `read` | safe | `pi-coding-agent` `core/tools/read.js`: file reads and in-memory image processing. |
| SDK `ls` | safe | `core/tools/ls.js`: existence, stat, and directory reads. |
| SDK `grep` | unsafe | `core/tools/grep.js` calls `ensureTool("rg")`; `utils/tools-manager.js` can download, extract, chmod, and install a binary. |
| SDK `find` | unsafe | `core/tools/find.js` calls `ensureTool("fd")`, with the same installation effects. |
| SDK `bash` | unsafe | Executes arbitrary shell commands. |
| SDK `edit`, `write` | unsafe | Change files. The Forgerie `edit` override in `piSessionService.ts` previews, then calls the writing SDK implementation. |
| `project_context` | unsafe | `projectTools.ts` → `ProjectWorkspaces.catalog/context` → `SessionWorktrees.info` → `git status`; Git can refresh/write the index. No `GIT_OPTIONAL_LOCKS=0` guarantee. |
| `project_worktree` | unsafe | Creates, lands, and deletes worktrees; read actions share the same registration. |
| `workspace_services` | unsafe | Starts, stops, and restarts Process Compose services. Status/log actions share the registration. |
| `github_read` | unsafe | `githubTools.ts` → `GitHubAgent.read`: reads can mint an installation token via POST; PR reads can POST GraphQL queries. |
| `github_write` | unsafe | Posts, patches, closes, labels, and merges GitHub objects. |
| `propose_issue` | unsafe | Persists a user-visible issue proposal. |
| `github_watch` | unsafe | Changes watches and can wake the parent. |
| `ask_user` | unsafe | Persists/publishes a question form and terminates the run. |
| `end_turn` | unsafe | Records a response declaration and terminates the run. |
| `spawn_session` | unsafe | Creates a session and delivers its first prompt. |
| `handoff_session` | unsafe | Creates a continuation session and ends the source run. |
| `child_agent` | safe | `durableChildAgents.ts`: `reporters[taskId]` reuses spawn/send. `createForChild(parent, taskId)` reuses an isolated worktree even if the call stops before the child receipt commits. |
| `propose_workflow` | safe | `durableWorkflowRuns.ts`: the proposal ID `p:${taskId}` reuses the proposal and its card atomically. |
| `workflow_finish` | safe | The stored finished outcome/result is the receipt. Replaying the same result returns without changing state or its timestamp. A different result is refused. |
| `workflow_stop` | safe | `stopReceipts[taskId]` commits with the stop/card. Replay returns its receipt even if the user approved or reopened the stop meanwhile. |
| `codemode` | unsafe | SDK `extensions/codemode/tool.js`: scripts can call effectful tools, model APIs, and append entries. Safe nested reads do not make the script safe. |
| bundled `process` | unsafe | `@aliou/pi-processes` `extensions/processes/tools/index.ts`: start/stop/stdin/update/clear effects share one tool. |
| bundled `subagents_enable` | unsafe | `src/extension/tool-activation.js`: changes the active loadout and records selection. |
| bundled `bg_wait` | unsafe | `src/runs/background/wait-tool.js`: can persist a wake subscription. |
| bundled `subagent_supervisor` | unsafe | `src/intercom/native-supervisor-channel.js`: writes replies and changes supervisor request state. |
| optional `contact_supervisor` bridge | unsafe | Writes/sends supervisor requests; not a read-only parent operation. |
| profile/project extension tools and overrides | unsafe | Arbitrary registrations pass through the fail-closed SDK adapter. No name grants safety. |

The bundled CLIProxy provider registers providers, not tools. The Forgerie skills
package supplies skills, not tools. `extensions/forgerie.ts` registers a command,
not a model tool. Durable `ask_human`, coding tools, and `watchdog_diff` are in the
child-only extension, excluded from the parent loadout; their child replay
contracts are outside this parent audit.

Optional eBay registrations remain unsafe: `ebay_seller_list`,
`ebay_seller_list_scheduled`, `ebay_seller_get`, `ebay_seller_update`,
`ebay_market_comps`, `ebay_seller_sales_history`, `ebay_price_recommendation`,
`ebay_seller_offers`, `ebay_seller_offer_respond`, `ebay_seller_messages`, and
`ebay_seller_message_reply`. The checked `ebay-seller` source uses Trading API
POSTs and OAuth token POSTs even for reads; updates, offer responses, and message
replies also change remote state. No external package was modified or executed.

## Optional host-profile registrations

These source files were read, not loaded or executed. They are not bundled or
pinned by Forgerie. Their registrations still use the fail-closed SDK adapter.

| Tool | Replay | Source reason |
| --- | --- | --- |
| `web_search` | unsafe | `rpiv-web-tools/web-tools.ts` selects providers that can POST search requests. |
| `web_fetch` | unsafe | Can POST through a provider and spills truncated content to a new temporary file. |
| `goal_complete`, `goal_blocked` | unsafe | `pi-goal/src/tools.ts` persists goal state and can terminate the run. |
| `youtube_fetch_subs` | unsafe | Runs yt-dlp and writes downloaded subtitle files. |
| `clean_vtt` | unsafe | Its `outPath` option writes a file; the text-only mode shares the registration. |
| `mobbin_search_screens`, `mobbin_search_flows`, `mobbin_search_sections` | unsafe | `pi-mobbin` sends MCP POSTs and can refresh/persist OAuth tokens. |
| `send_to_device` | unsafe | Sends files to a remote device. |
| `github_actions_list_runs` | unsafe | Configurable external `gh`/Nix subprocess execution has no Forgerie-owned read-only replay contract; remains conservative. |
| `github_actions_supervise`, `github_pr_supervise` | unsafe | Can dispatch workflows, download artifacts, and request merges. |
| `rocknix_artifact_verify` | unsafe | Downloads/extracts artifacts and writes/deletes temporary verification images. |
| `device_recovery_supervise` | unsafe | Runs external device/SSH commands without a Forgerie-owned read-only replay contract; remains conservative. |

Profile startup-context, direnv, and local-patch extensions have no model tool
registrations in the checked source. Project-local packages or future profile
changes can add more tools; they do not gain safety from a name.

## Cost and limits

Outside the receipt-backed native tools above, installation, token-minting,
mixed actions, and other writes receive interruption rather than automatic recovery. This costs automatic
progress; the model must decide whether to retry. An unsafe interruption does not
undo effects from the first attempt. A safe read can observe newer filesystem
content after a crash. Arbitrary extension hooks may also have effects: this
policy certifies the selected tool implementation, not all user-supplied hooks.

SDK crash tests use a real SQLite journal, a saved `pi.tool` execute checkpoint,
and a new hosted session. They prove that SDK `read` reruns, while SDK `write`
and a same-name custom `read` do not.

Native replay tests pause the real invocation after it commits its effect, close
the journal before settlement, and reopen it with the same task ID. They prove
no additional spawn, send delivery, reporter, worktree, proposal card, stop card,
or finish timestamp. Another test pauses before a child receipt commits and
reuses the worktree allocation. Stop tests also apply a user's changes decision
before replay: both a posted stop and an already-waiting call retain that decision.
A waiting-state guard alone would ask again, so task-keyed stop receipts are
necessary. These checks do not prove SIGKILL or host power-loss durability.

## Parent statistics

`getSessionStats()` sums the parent conversation's committed `pi.usage` model
and tool buckets. The journal initializes a synchronous read projection from
`UsageDoc` and follows exact commit publications. `DurableUsageStateSchema` is shared by
parent and child accounting. Invalid usage snapshots/commits are reported; the
listener keeps its last good value and never throws or prevents later listeners
from receiving a committed frame. A failing diagnostic callback becomes a Node
warning rather than a failed durable commit. Compaction, failed/aborted
attempts, and spend whose messages no longer remain in context are not inferred
from JSONL. Child conversation spend is not added. Transcript message and tool
call counts keep their existing meaning and return shape.

Consumers checked:

- `PiSessionService.statusFromSession()` copies `stats.tokens` and `stats.cost`.
- `SessionCommandService` formats those same fields for `/session`.
- `ClientSessionStatus` retains its token/cost shape.
- `ui/src/contracts.ts` currently omits parent token/cost fields from its status
  schema. The browser shows `/session` as command output, not a separate cost
  widget. Child work costs use child run ledgers and remain separate.

Legacy transcript-to-ledger migration is handled separately by #43. A fork's
initial ledger follows Durable's
conversation-local usage semantics, not copied transcript totals. There is no
fallback to transcript cost, which would reintroduce a second accounting source.


Read-only landed/discarded worktree status still uses `savedTranscriptUsage()`
in `piSessionService.ts`. Reading its ledger without resuming a session needs a
separate non-executing storage path; this remains a follow-up.
