# Grouped projects and cross-repo tools: implementation plan

Status: proposed plan, not implementation approval. The user chose planning after the [source research](2026-10-09-grouped-project-precedents.md). No production behavior changes are included in this document.

Inspected baseline: `9fab7ec4`. Planning worktree base: `94710986`; the additional commit does not change the project, picker or session/worktree contracts cited below.

## Outcome

KORI appears as a named group of existing projects. Every session still belongs to one normal project and one working directory. The agent can discover related projects, read their context, and request work in a specific project through tools. Grouping does not create a combined checkout, move sessions, merge settings, or change Git history.

Preserve existing capabilities by keeping their owners intact. A project continues to own its workspaces. A normal session continues to own its managed worktree and its PR watches. Cross-project coordination adds references between those owners rather than replacing them.

The proposed delivery is six small slices: group records, browser grouping, agent discovery, managed target-project work, linked results, and end-to-end acceptance. The first three do not require deciding how secondary write work is owned. Slice four has an explicit approval gate.

## Scope and non-goals

| Included | Not included |
|---|---|
| Named groups referencing registered projects. | A new multi-root session or group cwd. |
| Existing state/project session views, with group scope added. | Replacing the inbox with a new navigation model. |
| Same-host discovery and explicit target-workspace selection. | Automatic cross-machine placement or a shared filesystem pool. |
| Target-specific instructions and ordinary coding tools. | Merging every member's `.pi` configuration or running its extensions in the home session. |
| Managed cross-project work with visible provenance. | Treating shell-created worktrees as automatically Forgerie-owned. |
| Independent Land, Discard, PR and cleanup operations. | Atomic group landing, automatic merges or automatic group-wide deployment. |
| Current `ui/` client only. | Supporting the retired client or installing a second orchestration product. |

Existing remote-machine behavior stays unchanged. The first release exposes group collaboration only on the executing host. Unsupported remote targets return an explicit refusal, never a local fallback. A later federation change can qualify project references by machine without changing session cwd semantics.

## Existing implementation to preserve

| Existing seam | Verified behavior | Planned use |
|---|---|---|
| `src/server/projects/projectService.ts`, `storage/projectStore.ts` | A registered project has stable ID, name and path. The parser keeps only existing fields. | Keep those records unchanged; store groups separately. |
| `workspaces/workspaceService.ts` | Discovers ordinary project workspaces and supports non-Git folders. | Resolve targets through this catalog, not path guessing. |
| `workspaces/sessionWorktreeRoutes.ts` | `UserSessionWorktrees.start` creates a fresh managed worktree, starts a session and attaches its owner. | Reuse the sequence for target-project work after defining its agent-facing contract. |
| `workspaces/sessionWorktrees.ts`, `sessionWorktreeStore.ts` | Own setup retries, Land/Discard checks, cleanup and transcript preservation. Attachment expects the session cwd to equal its worktree. | Do not invent a second Git lifecycle in tools. |
| `sessions/spawnTargetResolver.ts`, `projectWorkspaceCwds.ts` | Existing spawn and relationship logic is scoped to the home project. | Preserve these defaults. Add a separate explicit collaboration resolver rather than broadening every caller. |
| `sessions/spawnSessionTool.ts` | `spawn_session` is independent; its results are unavailable to the caller. | Do not silently convert it into a managed collaboration tool. |
| `github/pullRequestService.ts`, `sessions/githubTools.ts` | PRs are keyed by repo and number, but operations validate against the owning session's cwd/origin. | Keep target PR operations in the target session; link to them from the coordinator. |
| `sessions/durableSdkTools.ts` | Tool-call event input is a copy; execution receives original arguments. | Do not install the researched workspace extension and rely on event-input mutation. |
| `ui/src/picker/board.ts` | State precedence, pins, age bands and project grouping are a pure projection. | Apply group scope without changing classification or duplicating sessions. |
| `ui/src/picker/catalogStore.ts` | Snapshot plus live-event replay; the current browser catalog is local-machine only. | Add group state without replacing session identity or reconnect behavior. |
| `ui/src/newSession.ts`, `ui/DestinationPicker.tsx` | Creation chooses an actual project/workspace and fresh/existing placement. | A group organizes choices but can never be the executable destination. |

## Invariants

1. Group rename, membership change and deletion never move directories, rewrite session headers or delete projects, branches, transcripts or PR links.
2. Session identity remains `{id, cwd}`. A group ID is not a session ID, repo selector, cwd or Git permission.
3. Every mutating cross-project operation names one validated target project and workspace. Resolve them on the server at admission time.
4. The caller identity comes from the live session context, not an arbitrary `sourceSessionId` supplied by the model.
5. A tool result identifies the actual target project, workspace, session and operation. Equal project names or PR numbers must not cause ambiguity.
6. No raw shell fallback after managed setup, scope or ownership validation fails.
7. The home session's file, Changes, PR, process and worktree panels remain scoped to that session. Linked target work is reachable through the target session's existing views.
8. No operation silently takes over an active or dirty checkout. Reuse must be explicit and pass existing checks.
9. Grouping does not authorize delegation, writes, merging or deployment. Existing user/task authorization rules still apply.
10. Closing or archiving the source session does not automatically discard work owned by another session.

## Decision gate: ownership of secondary write work

The revised request settles the home-session model. It does not settle who owns another repo's new worktree. This decision must be approved before slice four.

| Option | Behavior | Cost and limitation |
|---|---|---|
| **A. Normal target-project session, recommended** | A tool starts or addresses a normal session in repo B. That session owns its managed checkout, coding context, processes and PRs. The repo-A conversation coordinates and receives results. | Adds a visible session and, when prompted, another model run. It does not let the same agent directly perform all writes in both repos. |
| B. Secondary worktree attached to the home session | The repo-A agent edits repo B directly through an explicit managed handle, without another agent conversation. | Requires a new attachment/ownership lifecycle and target-aware status, PR and cleanup behavior. Much of the earlier multi-worktree integration work returns. |
| C. Raw paths and shell Git only | The home agent edits another checkout using absolute paths or `git -C`. | Smallest implementation, but cannot promise ordinary Forgerie ownership, Land/Discard or cleanup for that work. Does not meet the full feature-preservation goal. |

The detailed mutation plan below assumes **A provisionally**, following the Orca/T3 precedent. This is a recommendation, not an accepted change to the user's requirements. Do not create background target sessions silently. The tool contract and transcript must make the extra session explicit.

Cross-repo reads do not require A or another model. Reading related code and instructions remains possible from the home conversation. If the user requires the same agent to make every cross-repo edit, select B and revise slice four before implementing it.

## Slice 1: additive group catalog

**Deliverable:** group CRUD and membership with unchanged projects and sessions.

Proposed schema in `src/shared/projectGroups.ts`:

- `ProjectGroup`: stable ID, display name, ordered existing `projectIds`, revision and timestamps. No filesystem path or session list.
- Separate versioned group storage, under the configured Forgerie data directory. Do not rewrite `projects.json` or ignore its configured override.
- Membership uses IDs, never a project name or an inferred common parent folder. No automatic KORI population from the research candidates.
- A project can be referenced by more than one group in this proposal. Within a group, duplicates are invalid. A caller selects a specific group context; do not silently union unrelated groups for tool authority.

Use a `ProjectGroupCatalog` module with list/get/create/update/remove operations. It owns validation, revision conflict detection and storage failures. Group mutations must be serialized and published atomically. Browser routes and hosted tools must observe the same persisted revision, not separate long-lived copies.

Recommended wiring: the session daemon owns group mutations and their event publication; the web server exposes thin routes through the existing daemon transport. This avoids concurrent group writers in web and sessiond. Verify restart/read behavior before relying on process-local serialization. The authoritative schema lives in shared code; client decoding must have a contract test against it.

Proposed route family: `GET/POST /api/project-groups` and `GET/PATCH/DELETE /api/project-groups/:id`. Use the existing machine-route conventions; do not introduce another transport. Group writes include the expected revision. Removing a group only removes organization metadata. Closing a project leaves an explicit unavailable member until the user removes it, rather than silently reopening or recreating that project.

**Tests:** round-trip/restart, concurrent stale edits, malformed file/schema, duplicate members, unknown project IDs, empty group, same-name projects, project closure, and group deletion preserving the project/session stores byte-for-byte. Missing group storage means an empty catalog and today's behavior.

**Cost:** one new persistent catalog and transport contract. No session migration is needed.

## Slice 2: browser grouping without a second execution model

**Deliverable:** create/rename/delete groups, edit membership, and scope the session/destination lists by group.

Preserve the current visual language, fonts, status semantics and surfaces. This is an organization feature, not a restyle. Exact control composition must be reviewed using real parts before UI implementation is accepted.

Behavioral requirements:

- Keep `All` and ungrouped projects reachable. A group containing unavailable projects shows that state rather than an apparently complete list.
- A group scope filters the session pool before the existing state/project projection. Pinned, Needs your response, Working, unread and archive rules remain unchanged within that scope.
- State grouping remains state grouping. The existing `GroupKind` values in `picker/board.ts` must not be repurposed as project-group identities.
- Every session continues to show its real project/repo. Displaying it under KORI does not rename its home.
- The all-projects view contains each session once, even when its project belongs to two groups. Counts operate on unique session IDs.
- New-session creation always ends with a concrete project/workspace choice. Selecting KORI cannot silently select its first repo. Preserve the existing default-destination behavior when no group scope is active.
- Group metadata failure must not make ordinary sessions unreachable. Report that grouping is unavailable and keep the normal catalog usable.
- Preserve draft text, active session, selected destination, list position and open state across group refresh, rotation and fold/unfold. A stale membership write reports a conflict without losing the edit draft.

Implementation placement: group model and client adapter under `ui/src/projectGroups/`; picker integration in its existing model/store and a binding. Do not add fetch/storage to a shape. Existing domain-heavy `ui/Picker.tsx` and `ui/DestinationPicker.tsx` predate the new decomposition gates; changed portions must move toward the documented binding/shape/system split without growing the pending-offender list.

Search shared components before adding primitives. The current catalog includes `EventLine`, `AlertCard` and `CopyButton`, not a general group editor. Any new generic collection/disclosure/editor structure belongs in `ui/src/ui/`, with domain words supplied by feature shapes. Add `.part.tsx` fixtures for real loading, empty, long-name, many-members, unavailable-member and conflict states.

Do not add viewport-width layout switches. The collection can scroll; primary selection and management actions remain inline or in labeled overflow at every container size. Menus escape their container. Validate all four Fold 8 postures in both themes and the transitions between them.

**Cost:** the picker/destination seams carry existing decomposition debt. Extract only the touched structure, not a full chat rewrite. No legacy-client code is required.

## Slice 3: discover related projects and read target context

**Deliverable:** a read-only project tool plus target context, without starting agents or mutating workspaces.

Working tool name: `project_read`. Actions list groups, inspect one group's registered projects, and resolve one project's current workspaces/context. Return stable project/workspace IDs, canonical paths, Git/non-Git capability, and explicit unavailable states. IDs are the contract; names are labels.

The home session stays in its existing cwd. The tool does not change the process cwd, switch its model, install packages or execute target extensions. It identifies applicable target `AGENTS.md` files and skill/prompt locations, preserving their source paths and ordering. Load bounded relevant context on demand, not every group's entire contents into every turn. Equal resource names retain their target identity.

Reuse existing read/edit/bash mechanics for authorized filesystem access. Do not require `@repo` aliases for the first release: explicit validated paths already work and avoid collision with existing attachment/file-mention syntax. Browser file previews still use `pathAccessPolicy`; group membership alone must not add allowed filesystem roots. Open a target project's existing view when needed.

Implement target resolution once, in a `ProjectTargetResolver` module. It combines the registered project catalog, workspace discovery, current group revision and the executing host. Refuse stale, missing or ambiguous IDs. Use canonical paths and Git discovery rather than prefix matching for write-sensitive decisions.

**Tests:** same names/different IDs, moved or missing directory, linked worktree, non-Git project, shared repo in multiple groups, target instruction provenance, duplicate skill names, stale membership and symlink/path escape. Verify discovery does not create a session, alter settings or call a model.

**Cost:** catalog/context plumbing and stale-target checks. Ordinary file tools remain host-privileged; this is not a new OS sandbox.

## Slice 4: managed target-project work, after ownership approval

**Deliverable under option A:** a home-session tool creates a normal target-project session with an owned workspace, sends a bounded task and returns a durable link.

Use a `ProjectCollaboration` module to own admission, retry receipts, target resolution and links. Its small interface is `start`, `inspect`, `send` and result delivery. It hides the sequence and failure states; it must not duplicate Git worktree algorithms.

Working contracts:

| Operation | Required input | Result and policy |
|---|---|---|
| `project_work start` | Explicit group/project ID, task, stable request ID, fresh-worktree or explicitly selected existing workspace. | A normal target session ref, target workspace/worktree ID and operation status. Fresh worktree is the Git default. No group-wide startup. |
| `project_work send` | An existing authorized collaboration link, stable message ID and bounded text. | A durable delivery receipt. Accepted, queued and completed are different states. A receipt is not task success. |
| `project_work_read` | Link/operation ID and bounded cursor where needed. | Target status, result summary and artifact/session references. No model-backed polling loop. |

Names are proposals; finalize schemas and exposure before coding. Creation and message delivery are model-only tools so they remain visible transcript operations, not hidden codemode calls. Read-only inspection can be callable from codemode under the existing policy.

Start sequence:

1. Resolve the live source session and exact target; check user/task authorization and existing delegation/config ceilings. Group editing is not authorization to execute code.
2. Persist an intent keyed by source session, request ID and a fingerprint of the request. Same key/same input returns the existing operation; changed input is refused.
3. Create or reuse the target through existing managed-session/worktree services. Explicit reuse must not silently take over a different session's checkout. Provisioning failure retains a retryable receipt and does not create another branch on retry.
4. Persist target session/workspace identity before first prompt delivery. Reconcile interrupted creation from existing setup/session receipts. Do not rely only on the in-memory `pending` map.
5. Deliver the bounded task exactly once according to the durable message contract. Use the target's cwd for its instructions, settings, hooks and extensions. State whether model/thinking were explicitly selected or inherited; do not silently substitute a model.
6. Return the actual target identity and links. If delivery fails after creation, expose `created, not delivered` and retry delivery to that target, not session creation.

The target is an ordinary session, not a fork of the source transcript. Record a collaboration edge separately from Pi's history/parent path and Git branch ancestry. Do not broaden `RegisteredProjectWorkspaceCwds` to all group repos: it serves existing tree and handoff contracts too.

Store link/provenance and delivery state, not a second source of truth for worktree status. The target's `SessionWorktreeRecord` remains authoritative. A link records whether a workspace was newly created or explicitly reused. Archive/delete of a source detaches or retains the link according to history policy; it never silently stops the target, closes its PRs or deletes its checkout.

For tasks requiring a delegated agent, use the bundled `pi-subagents` where its public contracts fit. Do not monkey-patch it, start external CLI fallbacks, or falsely present its temporary worktrees as normal Forgerie-owned ones. Ordinary target sessions plus result delivery and subagent-owned temporary runs must remain distinct in records and UI.

**Tests:** two real Git repos; same-request retry; different payload/same key; crash after intent, worktree creation, session creation and message acceptance; setup-hook failure; busy/dirty target; duplicate delivery; cancellation; source/target deletion; group membership changes while work is active; target instruction loading; nested delegation ceilings. No live paid model is required for the deterministic contract tests.

**Cost:** new durable coordination state and possibly an additional model run. This is the largest slice. Do not replace it with raw `git worktree add` and call feature parity complete.

## Slice 5: results and target-owned controls

**Deliverable:** the coordinator sees where work happened and can open its normal owner views.

A result includes target project, target session, worktree, checks run, outcome and artifact references. Use the shared `EventLine`/`AlertCard` mechanisms with a feature-owned binding; do not create another transcript renderer. Both sessions retain source/target provenance. Completion is a separate event from launch or message delivery.

Keep home-session Changes scoped to home. A link opens the target session's Changes, Land/Discard, PRs, processes or transcript. A summary cannot imply that the home Changes panel includes every related repo. Group-wide lists are projections of existing items and retain their owner identity, not cloned records.

Preserve PR behavior by operating through the target owner. Do not insert a repo-B PR into repo-A's watch loop and assume the stored repo string is sufficient: `PullRequestService.requireRepo` still checks the owning cwd. Cross-project reporting can link that target PR without changing its owner. Any later cross-home PR-control feature needs an explicit repo-aware contract across tools, API, watch polling and merge confirmation.

Use durable result delivery with a source session ID and deduplication ID. Queue or retain delivery for an unavailable source; do not silently create a new source session. Reconnect must reconstruct links/results without re-running tasks. A failed UI note after a successful PR merge must not be reported as a failed merge.

**Tests:** equal PR numbers in different repos, result replay, archived source, missing target, target completed then cleaned up, failed result notification, same-session multiple PRs, and successful merge followed by failed note delivery.

**Cost:** links and result delivery, not a combined lifecycle. No "Land all" in this plan.

## Slice 6: feature-preservation and release gate

A group-only release can land after slices 1–2 without removing any existing feature. It must not be described as completed cross-repo collaboration. The complete feature requires the approved ownership option and the acceptance evidence below.

| Capability | Acceptance evidence |
|---|---|
| Existing sessions | Old JSONL paths/IDs, history, resume and tree/fork behavior work without rewriting existing sessions. |
| New sessions | Ungrouped, grouped and non-Git project creation preserve model/thinking, attachments, first-message failures and fresh/existing destination choices. |
| Picker | Pinned, Needs your response, Working, unread, search and archive work with and without group scope; no duplicated sessions/counts. |
| Chat | Drafts, queue/steer, stop, compaction, ask/dialog state, images, speech and reconnection retain existing behavior. |
| Worktrees | Setup hooks, ownership, rename, Land, Discard confirmation and archive cleanup work independently in repos A and B. |
| File review | Each repo's diff, annotations, file mentions, previews and file safety stay reachable in its owner view. |
| GitHub/backlog | Multiple PR links/watches, CI gates, merge confirmation and issue/backlog claims remain scoped to their owner. Same-number PRs do not collide. |
| Processes/terminals | Target cwd, environment, logs, stdin, stop and cleanup use the target session. Source archive does not kill target work. |
| Delegation/handoff | Existing same-project contracts and authorization ceilings remain unchanged. Cross-project collaboration uses its explicit new contract. |
| Crash/retry | Restart at each creation/delivery checkpoint produces one target session/worktree and one accepted task, or an explicit recoverable failure. |
| Cross-repo correctness | A real fixture tests code in A against the intended B revision through explicit local dependency wiring. Adjacent directories are not sufficient. |
| Devices | Inspect Caliper parts and in-app captures at 704×783, 932×553, 475×638 and 711×374, in light/dark modes, plus fold/rotation transitions. |

Commands for implementation acceptance, on Node 24:

```sh
nix shell nixpkgs#nodejs_24 -c npm run verify
nix shell nixpkgs#nodejs_24 -c npm --prefix ui run gates
node scripts/capture-postures.mjs --url http://127.0.0.1:8504/ --out /tmp/project-groups-dark --label groups --color-scheme dark
node scripts/capture-postures.mjs --url http://127.0.0.1:8504/ --out /tmp/project-groups-light --label groups --color-scheme light
```

Use the correct isolated dev URL during implementation, not an unrelated running build. Run the project's pending-gate and Caliper rendering checks from `ui/docs/decomposition.md`; read the PNGs. Do not use raw Chromium window-size screenshots. Include new group and linked-work fixtures in those runs. Tab Ultra validation starts only after its CSS viewports are measured, per `AGENTS.md`.

After user-facing code lands on main, build and restart the local units under `AGENTS.local.md`, then verify the deployed group/tool flow. Coordinate the sessiond restart because it affects active runs. This documentation-only plan does not require deployment.

## Rollout, rollback and decision record

Keep the group catalog additive and absent-by-default. Disabling group presentation restores the flat catalog without deleting metadata. Before rolling back collaboration tools, stop new admissions and let existing target sessions finish or hand their ownership to the user. Keep ordinary target sessions and operation receipts; do not delete them to make a rollback look clean.

The UI refresh path must tolerate an older server that lacks group endpoints without losing normal projects. New tool availability follows the server's actual capability, not a client version guess. Add schema-version checks and a clear unsupported state for stored collaboration records a binary cannot read.

Before implementation, confirm the proposed ownership option A, same-host initial scope, and multiple-group membership. The first is the blocking product decision for managed cross-repo writes. The real KORI membership list is also not established; configuration must come from the user rather than README-name inference.

Recommended first implementation unit: group storage/contract plus its CRUD tests, then one complete picker/destination slice. Do not start by refactoring session identity or broadening filesystem permissions.

## Planning evidence and validation

This plan follows the source-cited Orca/T3/Pi research, not a claim that their code is a drop-in dependency. The current project store, catalog/picker model, destination selection, daemon wiring, spawning contract and PR service were inspected directly. No production component, schema, tool or runtime code was changed.

Documentation validation: `npm run verify` passed on Node 24 in the isolated planning worktree. Backend/static verification passed with 2,196 tests passed and four skipped across 228 files; UI build/lint/gates and 1,080 tests across 113 files passed. `git diff --check` passed. The log is `/tmp/forgerie-grouped-project-plan-verify.log`.

Those are baseline checks for a documentation-only change. The acceptance matrix above describes future implementation tests, not tests passed by a feature that does not exist yet. No UI was changed or visually validated in this planning task; posture/Caliper checks are required when the planned UI is implemented.
