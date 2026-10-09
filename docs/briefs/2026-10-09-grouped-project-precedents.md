# Grouped projects and cross-repo tools: existing implementations

Date: 2026-10-09 UTC. Research only. No extension was installed and no third-party application was started. The user wants named groups of normal projects, one home project per session, and tools for cross-repo work. A mandatory multi-root session is not the target.

Status: online Pi-extension and local seven-clone source reviews complete. Runtime compatibility and end-to-end cross-repo behavior were not tested.

## Answer

Orca is the closest implemented precedent for the revised design. It groups independent repository records for organization while keeping execution repo-scoped. Its tools can create a managed worktree in an explicitly selected repo and communicate with target workers. T3 Code supplies another strong example of tools that launch an ordinary session in another registered project.

The Pi ecosystem already has useful parts of this design. The closest lightweight example is Nelson Brandão's `workspace` extension: one normal session cwd, named external folders, path aliases in file tools and directory variables in shell commands. It does not own worktrees or PR lifecycles.

Forgerie already bundles another useful part: `pi-subagents` accepts a child cwd and can manage isolated worktrees with handoff artifacts. That does not automatically make those worktrees ordinary Forgerie-managed sessions. The identities and cleanup rules must be connected deliberately.

The recommendation is to reuse these patterns and existing Forgerie services, not install an unrelated coordinator and assume its lifecycle matches Forgerie's. The remaining product work is group membership, explicit target selection, instruction scope and cross-project ownership/visibility.

## The seven cloned applications

All seven snapshots were inspected read-only under `/tmp/meta-harnesses`. Existing tests were read as evidence of intended contracts, not executed. "Not established" below is limited to the inspected source paths and is not a claim about every plugin or later version.

| Clone | What the source establishes | Match to the revised model |
|---|---|---|
| **Orca** | Named groups contain independent repo records. Sessions run in one workspace. Worker tools accept a target repo and can provision a managed worktree; messaging uses durable sender/dispatch identity. | **Closest match.** The group organizes repos rather than becoming their execution root. Cross-repo operations are separate, explicit actions. |
| **T3 Code** | `t3_thread_launch` accepts a target `projectId` and root/new-worktree/existing-worktree strategy. Threads can address other projects' threads. | **Strong tool precedent.** Its logical grouping consolidates the same repo across clones/hosts, not arbitrary independent repos. |
| **Codex** | Persistent named projects hold several directory roots separately from a thread's cwd. Managed worktrees can be attached without changing that cwd. | **Partial.** These are path collections, not groups of normal repo-project records. Inspected native subagents inherit cwd; worktree tools use the caller's repo. |
| **Omnigent** | Named projects are session containers. Sessions bind to a selected workspace. PR association is independent of checkout cwd. | **Partial.** Inspected session-creation tools create children without target-project/workspace arguments; messaging writes are child-only. |
| **EmDash** | Ordinary project/task/workspace ownership, managed worktree provisioning and one-cwd agent launch are implemented. | **Adjacent infrastructure.** A named independent-repo group and built-in cross-project agent-coordination tool path were not established in the inspected schema/adapters. |
| **Stanford Meta-Harness** | The inspected controller optimizes a candidate harness across benchmark task suites. | **Different problem.** Task suites are not registered repo projects or project-agent collaboration. |
| **Superagentic Meta-Harness** | The engine copies one baseline into candidate workspaces, runs a proposer and evaluates changes. | **Different problem.** Optional extra writable directories do not establish project groups, target-agent messaging or managed target worktrees. |

### Orca: separate organization from execution

At `7faa9f7cd3bda68189646b1e9def6cc8aae3b1cb`, [`Repo.projectGroupId`](https://github.com/stablyai/orca/blob/7faa9f7cd3bda68189646b1e9def6cc8aae3b1cb/src/shared/repo-types.ts#L114-L119) is documented as:

> Durable sidebar-only repo organization. Execution remains repo-scoped.

[`ProjectGroup`](https://github.com/stablyai/orca/blob/7faa9f7cd3bda68189646b1e9def6cc8aae3b1cb/src/shared/project-group-types.ts#L1-L19) stores a name and organization metadata. A [persistence test](https://github.com/stablyai/orca/blob/7faa9f7cd3bda68189646b1e9def6cc8aae3b1cb/src/main/persistence-folder-scan-project-groups.test.ts#L74-L137) retains two independent repo records and their membership across a Store restart.

The important cross-repo implementation is [`createWorkerWorktree`](https://github.com/stablyai/orca/blob/7faa9f7cd3bda68189646b1e9def6cc8aae3b1cb/src/main/runtime/rpc/methods/orchestration/worker/worker-worktree-creation.ts#L45-L89). It passes `params.repo ?? coordinatorWorktree.repoId` to the existing managed-worktree service, records created resource effects, and preserves recovery information. `new-top-level` avoids inventing Git ancestry between different repositories. The [explicit-target test](https://github.com/stablyai/orca/blob/7faa9f7cd3bda68189646b1e9def6cc8aae3b1cb/src/main/runtime/rpc/methods/orchestration/worker/workers-new-worktree.test.ts#L303-L329) checks target-repo argument plumbing, but uses mocked creation rather than two real Git repositories.

[Messaging](https://github.com/stablyai/orca/blob/7faa9f7cd3bda68189646b1e9def6cc8aae3b1cb/src/main/runtime/rpc/methods/orchestration/messaging/send-point-to-point.ts#L64-L162) records sender/run/dispatch identity and mailbox state before wakeup. [PR merging](https://github.com/stablyai/orca/blob/7faa9f7cd3bda68189646b1e9def6cc8aae3b1cb/src/main/runtime/rpc/methods/github-pull-request-update-methods.ts#L14-L47) requires a repo selector. Worker release, worktree removal and PR merge remain distinct operations.

Recommendation: copy this separation of responsibilities, not Orca's whole runtime. Cost: Forgerie must still connect target selection to its own session, worktree and PR records. Group membership in Orca is not proof of cross-repo authorization or an exhaustive edit ledger. Group deletion also has folder-workspace cleanup side effects in its implementation, so do not blindly copy its delete behavior.

### T3 Code: launch another normal session instead of changing the current one

At `d386414097003a395aa983315d6a907463f13db6`, the [project-tool handler](https://github.com/pingdotgg/t3code/blob/d386414097003a395aa983315d6a907463f13db6/apps/server/src/mcp/toolkits/project/handlers.ts#L43-L155) resolves a target `projectId`, creates an ordinary top-level thread, and records `senderThreadId` on the initiating message. [`ThreadLaunchService`](https://github.com/pingdotgg/t3code/blob/d386414097003a395aa983315d6a907463f13db6/apps/server/src/orchestration-v2/ThreadLaunchService.ts#L384-L500) binds the target project's root or managed worktree before starting the agent. Target-project setup scripts run there.

[Thread messaging](https://github.com/pingdotgg/t3code/blob/d386414097003a395aa983315d6a907463f13db6/apps/server/src/mcp/OrchestratorMcpService.ts#L2023-L2089) resolves the target's own project and checks caller/run permissions. Its [cross-project integration test source](https://github.com/pingdotgg/t3code/blob/d386414097003a395aa983315d6a907463f13db6/apps/server/src/mcp/OrchestratorMcpToolkit.integration.test.ts#L2375-L2421) exercises foreign-project thread addressing, but not the complete launch/message/PR/cleanup chain across two repositories.

Do not confuse this with T3's [project grouping](https://github.com/pingdotgg/t3code/blob/d386414097003a395aa983315d6a907463f13db6/packages/client-runtime/src/state/projectGrouping.ts#L98-L149): the logical key comes from canonical repository identity, optionally with a monorepo subpath. This is not the arbitrary KORI group the user described.

Recommendation: copy the explicit target-project launch/message contract. Cost: another normal session record and its lifecycle, plus authority checks. Direct cross-repo reads still do not require a second agent. A missing launch response must not cause a blind duplicate launch.

### Other useful partial patterns and snapshot inventory

| Clone and inspected commit | Primary source used | Useful distinction |
|---|---|---|
| [Codex `73178e7`](https://github.com/openai/codex/commit/73178e7ca60fe8655c49727e60a467d7c03f896c) | [Project schema](https://github.com/openai/codex/blob/73178e7ca60fe8655c49727e60a467d7c03f896c/codex-rs/app-server-protocol/src/protocol/v2/project.rs#L15-L34); [worktree tool](https://github.com/openai/codex/blob/73178e7ca60fe8655c49727e60a467d7c03f896c/codex-rs/tui/src/managed_worktree_tools.rs#L169-L290); [child config](https://github.com/openai/codex/blob/73178e7ca60fe8655c49727e60a467d7c03f896c/codex-rs/core/src/agent/child_config.rs#L105-L198) | Membership, cwd, filesystem permissions and attached resources are different concepts. |
| [EmDash `e6370db`](https://github.com/generalaction/emdash/commit/e6370dbb7f5ec127c9923d7d6f4c41cfb83c6ffb) | [Schema](https://github.com/generalaction/emdash/blob/e6370dbb7f5ec127c9923d7d6f4c41cfb83c6ffb/apps/emdash-desktop/src/core/services/app-db/node/schema.ts#L66-L90); [launch resolver](https://github.com/generalaction/emdash/blob/e6370dbb7f5ec127c9923d7d6f4c41cfb83c6ffb/apps/emdash-desktop/src/core/features/tasks/api/node/task-session-launch-context.ts#L53-L135); [worktree creation](https://github.com/generalaction/emdash/blob/e6370dbb7f5ec127c9923d7d6f4c41cfb83c6ffb/packages/core/src/runtimes/workspace-registry/node/create-worktree.ts#L10-L60) | Backend workspace services are not automatically agent-facing cross-project tools. |
| [Omnigent `8a9269c`](https://github.com/omnigent-ai/omnigent/commit/8a9269cded4478a9f884b15244ea6ea9b332ec00) | [Session-container schema](https://github.com/omnigent-ai/omnigent/blob/8a9269cded4478a9f884b15244ea6ea9b332ec00/omnigent/db/db_models.py#L775-L839); [child-tool dispatch](https://github.com/omnigent-ai/omnigent/blob/8a9269cded4478a9f884b15244ea6ea9b332ec00/omnigent/runner/tool_dispatch.py#L3304-L3360); [PR ledger](https://github.com/omnigent-ai/omnigent/blob/8a9269cded4478a9f884b15244ea6ea9b332ec00/omnigent/runner/session_prs.py#L40-L173) | A PR can belong to a conversation without belonging to its home checkout. PR association still does not establish worktree custody. |
| [Orca `7faa9f7`](https://github.com/stablyai/orca/commit/7faa9f7cd3bda68189646b1e9def6cc8aae3b1cb) | Group, worker and messaging sources above. | Organization and repo-scoped execution compose without a mandatory aggregate workspace. |
| [T3 Code `d386414`](https://github.com/pingdotgg/t3code/commit/d386414097003a395aa983315d6a907463f13db6) | Project launch and grouping sources above. | Ordinary target-project threads can be launched from another project's agent. |
| [Stanford `8123cca`](https://github.com/stanford-iris-lab/meta-harness/commit/8123ccabe2b19fa1123090b2e5f1bacc20963ce8) | [Controller](https://github.com/stanford-iris-lab/meta-harness/blob/8123ccabe2b19fa1123090b2e5f1bacc20963ce8/experimental/harbor_meta_harness/controller.py#L54-L125); [candidate agent](https://github.com/stanford-iris-lab/meta-harness/blob/8123ccabe2b19fa1123090b2e5f1bacc20963ce8/experimental/harbor_meta_harness/agents/meta_harness.py#L53-L138) | Benchmark tasks and evaluator children are not normal project sessions. |
| [Superagentic `b8deaf6`](https://github.com/SuperagenticAI/metaharness/commit/b8deaf6ba62cd2acac4b0a5b30f9f2d1c21ef71f) | [Engine](https://github.com/SuperagenticAI/metaharness/blob/b8deaf6ba62cd2acac4b0a5b30f9f2d1c21ef71f/src/metaharness/core/engine.py#L26-L59); [candidate filesystem store](https://github.com/SuperagenticAI/metaharness/blob/b8deaf6ba62cd2acac4b0a5b30f9f2d1c21ef71f/src/metaharness/store/filesystem.py#L59-L99); [Codex adapter](https://github.com/SuperagenticAI/metaharness/blob/b8deaf6ba62cd2acac4b0a5b30f9f2d1c21ef71f/src/metaharness/proposer/codex_exec.py#L44-L85) | Candidate copies and additional writable directories are not managed cross-project collaboration. |

## Pi extensions

| Candidate | Verified source behavior | Fit and limit |
|---|---|---|
| `workspace` in `NelsonBrandao/pi-agent-extensions` | Loads `.pi/workspace.json` at the home cwd, injects a folder roster, resolves `@name/path` for read/write/edit, prepends `WS_*` exports to bash, and discovers sibling skills/prompts. | Closest match for one home session with cross-repo file access. No Git ownership, PR lifecycle or project-group UI in the inspected extension. |
| `pi-subagents` 0.76.1, already bundled | Child launch accepts a cwd. Managed worktree isolation records ownership, captures diffs/handoff artifacts and supports cleanup. | Reuse candidate for delegated work in another repo. Its worktree lifecycle is not the same as Forgerie's normal session Land/Discard lifecycle. |
| `pi-messenger` | Agent registrations include cwd. With folder scoping disabled, discovery can include agents in different directories. Direct messages address agent names; file reservations are stored with agents. | Useful for communication between existing project sessions. It does not supply a named Forgerie project group or own cross-repo worktrees/PRs. Crew planning state remains project-scoped. |
| `pi-fixit` | Config maps repo keys to paths; it creates a worktree per configured repo, injects repo context, persists session task state and supplies `create_mr(repo, ...)`. | Concrete example of repo-targeted tools and per-repo tracking, but closer to the earlier all-repo workflow than the revised lightweight grouping. Several policies conflict with Forgerie. |
| `pi-herdr-multi-repo-subagents` | A task root discovers repos; children run in selected repo paths. An SQLite-backed checkout reservation prevents competing managed implementers. Task records can refer to several repos. | Useful ownership and target-selection patterns. It requires Herdr panes and introduces an orchestrator/task-lead hierarchy rather than retaining an unrestricted ordinary home-repo session. |

### 1. Workspace aliases: the closest direct match

At commit `a35aadd7b739e11c18df84266147c323edc5329f`:

- [`config.ts`, lines 43–97](https://github.com/NelsonBrandao/pi-agent-extensions/blob/a35aadd7b739e11c18df84266147c323edc5329f/extensions/workspace/config.ts#L43-L97) loads folders from the current directory's `.pi/workspace.json`. Paths can be relative or absolute; explicit names disambiguate folders.
- [`index.ts`, lines 64–114](https://github.com/NelsonBrandao/pi-agent-extensions/blob/a35aadd7b739e11c18df84266147c323edc5329f/extensions/workspace/index.ts#L64-L114) retains the session cwd and adds resource discovery, prompt context and tool-call interception.
- [`resolver.ts`, lines 9–45](https://github.com/NelsonBrandao/pi-agent-extensions/blob/a35aadd7b739e11c18df84266147c323edc5329f/extensions/workspace/resolver.ts#L9-L45) implements `@folder/path` and shell exports. Lines 48–128 discover skills/prompts and describe their origin to the model.

This is real implementation, not just a README feature list. The extension treats folders as filesystem paths, not registered Git projects. It does not create worktrees, assign their owners, or register PRs. It does not load every member's `AGENTS.md` in the inspected discovery function. Folder aliases are routing convenience, not a filesystem security boundary: path resolution itself permits `..`.

Important Forgerie compatibility finding: the extension mutates `event.input.path` and `event.input.command` in `tool_call`. Forgerie's `src/server/sessions/durableSdkTools.ts:128–145` builds `input` through `durableJson(args)` but executes the original `args`. `durableJson.ts` constructs new objects. Source inspection therefore indicates that this mutation-based routing will not reach the underlying tool through that adapter. This was not exercised as a live extension test. It also imports the older `@mariozechner` SDK namespace.

Recommendation: borrow the named-target map, but resolve target paths in Forgerie's tool adapter or a supported argument transformation mechanism. Keep the existing UI mention syntax distinct from model tool arguments. Cost: an adapter plus validation of targets and reload behavior, not a zero-change package installation.

### 2. Reuse the bundled delegation engine

The installed package is `pi-subagents` 0.76.1, repository [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents). Inspected installed implementation:

- `src/runs/background/runner-child-launch.js:10–42` passes `cwd: step.cwd ?? ctx.cwd` into the child launch.
- `src/runs/shared/child-session.js` creates ordinary Pi child sessions through the SDK.
- `src/runs/foreground/subagent-executor.js:3163–3185` passes the chosen cwd and worktree settings to `createWorktrees`.
- `docs/workflows.md:435–455` documents managed isolation, source cleanliness, ownership journals, patch/handoff artifacts and cleanup.

This is a reusable execution mechanism, not an existing named group registry. It also does not mean Forgerie's `spawn_session` cross-project restriction has already changed: those are different tools with different routing contracts.

Recommendation: build project-aware targeting over the existing engine when delegation is desired. Do not force every cross-repo read into a separate agent. Cost: mapping target project/workspace identity to the delegated run and preserving user-visible artifact and worktree ownership. No cross-repo delegated mutation was launched in this research.

### 3. Messaging across existing project sessions

At `09937ed647a1b07a3b595bf75943feacb80ff123`, [`pi-messenger/store.ts:168–255`](https://github.com/nicobailon/pi-messenger/blob/09937ed647a1b07a3b595bf75943feacb80ff123/store.ts#L168-L255) filters agents by cwd only when `scopeToFolder` is enabled. [`handlers.ts`](https://github.com/nicobailon/pi-messenger/blob/09937ed647a1b07a3b595bf75943feacb80ff123/handlers.ts) implements join/list/send/reserve/release and stores each participant's cwd. Its README distinguishes a shared registry/inboxes from project-local Crew/feed data.

Recommendation: reuse the concept of addressing another project's existing agent and returning a result to the home conversation. Cost: message delivery and file reservations do not replace Git ownership, coordinated releases, or integration tests. Reservations are not a universal filesystem lock.

### 4. Repo-aware PR tools: useful example, unsafe policies to copy blindly

At `7f8cf3061996aed4cd07f88a099c06cc25f7e955`:

- [`src/workspace.ts:83–213`](https://github.com/fabkho/pi-fixit/blob/7f8cf3061996aed4cd07f88a099c06cc25f7e955/src/workspace.ts#L83-L213) creates worktrees for configured repos. It also prunes stale worktree metadata and symlinks mutable `node_modules` and `vendor` from main checkouts.
- [`src/tools.ts:26–210`](https://github.com/fabkho/pi-fixit/blob/7f8cf3061996aed4cd07f88a099c06cc25f7e955/src/tools.ts#L26-L210) validates a repo key, resolves its worktree, runs hooks, stages all changes, commits, pushes and creates a PR/MR from that cwd. Results are keyed by repo.
- [`extension/index.ts`](https://github.com/fabkho/pi-fixit/blob/7f8cf3061996aed4cd07f88a099c06cc25f7e955/extension/index.ts) restores and persists task state and implements sequential merging.

Do not copy its merge behavior into Forgerie. The inspected GitHub branch at lines 346–356 invokes `gh pr merge <number> --merge --delete-branch` without a target repo or target cwd. Source inspection raises a wrong-repository risk when operating from another home repo. Its merge method also differs from Forgerie's rebase policy. No merge command was run here.

Recommendation: borrow explicit repo keys and repo-keyed result tracking only. Reuse Forgerie's GitHub authentication, gates and worktree services. Cost: integration remains necessary; sharing dependency directories would weaken isolation.

Search also found npm packages `pi-multirepo` 0.3.1 and `pi-multifix` 0.2.0, both pointing to repositories under the same author. Their package metadata was inspected at [pi-multirepo](https://unpkg.com/pi-multirepo@0.3.1/package.json) and [pi-multifix](https://unpkg.com/pi-multifix@0.2.0/package.json). Do not count these search hits as three independently verified solutions. The implementation examined here is the current `pi-fixit` checkout.

### 5. Explicit checkout ownership with Herdr

At `00c4c0d76967e0a9aba68530171ff7ee0c099475`:

- [`src/core.mjs:950–1058`](https://github.com/coolofficials/pi-herdr-multi-repo-subagents/blob/00c4c0d76967e0a9aba68530171ff7ee0c099475/src/core.mjs#L950-L1058) selects repository/role scope and reserves an exclusive checkout for implementers.
- [`src/core.mjs:1128–1174`](https://github.com/coolofficials/pi-herdr-multi-repo-subagents/blob/00c4c0d76967e0a9aba68530171ff7ee0c099475/src/core.mjs#L1128-L1174) records the target cwd, parent identity and child session directory before launching a Pi agent in a Herdr pane.
- [`src/lifecycle.mjs:226–271`](https://github.com/coolofficials/pi-herdr-multi-repo-subagents/blob/00c4c0d76967e0a9aba68530171ff7ee0c099475/src/lifecycle.mjs#L226-L271) reserves checkout paths in SQLite. Unknown or not-cleanly-exited owners block replacement rather than silently surrender ownership.

This solves checkout coordination inside its own process/pane model. It is not a normal Forgerie project-group UI, nor does the inspected reservation code establish managed Git worktree creation or Forgerie's Land/Discard integration. The package's documentation explicitly separates its tool restrictions from an OS sandbox.

Recommendation: borrow explicit owner identity and conservative recovery rules. Cost: adopting its complete runtime would introduce a second orchestrator, role model and pane lifecycle that do not match Forgerie's web-native sessions.

## Scope and reproducibility

The parent searched the web for Pi multi-repo, workspace and collaboration extensions, then fetched primary README/package sources and acquired four public shallow clones for implementation inspection. Two initial parallel Brave searches were rate-limited; subsequent queries were sequential. Search results were discovery aids, not final evidence.

Public source snapshots are under `/tmp/forgerie-pi-grouping-sources-mq9pp4ez/`, with an `inventory.json` containing remotes and commit IDs. No lifecycle scripts, package installs, third-party tests or model-backed demos were run. The seven existing clones and their pinned commits are listed above.

The seven-clone source review was delegated to run `a66170f4-7200-41e5-9574-03d64f7b699f`, with a detailed retained report at `/tmp/forgerie-project-group-harnesses.md`. The parent read the strongest Orca/T3 implementations directly and synthesized the findings here. Public source links use local Git remotes and commits; they were not all individually fetched online.

Remaining verification gap: a real two-repo Forgerie scenario that discovers repo B from a repo-A session, creates or reuses B's managed checkout, exchanges messages, associates its PR and cleans up independently. Source-level precedents reduce design uncertainty; they do not verify Forgerie compatibility.

Forgerie source inspected at main `a4766419`. The old `new-ui-mvp` path now resolves to `ui/` on main. This report is written in an isolated documentation worktree; existing dirty files in main and all cloned repos remain untouched.

### Verification of this documentation change

The parent's link validator checked 37 source-file links against 11 local source snapshots and their pinned Git revisions. One overlong EmDash range was corrected. The child separately validated its full retained report's 119 citations and confirmed its seven clones stayed clean.

Forgerie's `npm run verify` passed static checks, then timed out one hosted codemode test at 5 seconds: 2,193 tests passed, one failed and four were skipped. The affected test file passed all seven tests on an isolated rerun. The separately run `npm run verify:ui` passed build/lint/gates and 1,067 tests across 112 files. The original complete verification command therefore did not pass; an isolated retry is not described as a clean full-suite result. These are baseline checks for a documentation-only change, not runtime tests of the researched third-party features.

No production code or services changed. No deployment is required.
