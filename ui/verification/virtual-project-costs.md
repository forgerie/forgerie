# Virtual projects: which costs remain?

Research date: 2026-10-09 UTC. Status: local checks and direct external-source review complete. This is research, not an approved implementation design.

## Answer

The earlier heading "Costs that do not go away" was too broad. Independent Git repositories have a real coordination limit. Setup overhead is reducible. Configuration scope needs explicit rules. Session persistence is an integration task, not a Git restriction.

The earlier promise that every feature can be kept was also too absolute. The evidence does not require removing Forgerie's built-in features. It does not prove that every arbitrary Pi extension works unchanged from a multi-repo parent directory.

The target is the new UI after it moves to `main`. The legacy UI is being removed. This research does not propose maintaining both clients.

| Earlier claim | Corrected finding | Classification |
|---|---|---|
| Landing across repos is not atomic. | Ordinary Git operations do not provide an all-or-nothing transaction across independent repositories. Preflight reduces expected failures but does not eliminate races or crashes. | An underlying limit of the proposed Git workflow. |
| Setup time multiplies by N. | More workspaces consume resources, but elapsed time is not necessarily N times one setup. Reuse and bounded concurrency change the cost. | Reducible overhead; no KORI benchmark exists here. |
| Repo settings conflict, so Forgerie must pick one. | Repo-local instructions and resources can remain scoped. A single session still needs one value for session-wide settings. Arbitrary extension isolation is harder. | Product policy plus compatibility work. |
| Pi stores sessions by working folder. | This is the default layout, not a requirement that the folder be a Git repo. Explicit storage directories work. Forgerie must preserve its existing identity and cleanup contracts. | Integration and lifecycle work. |

## Evidence boundary

Backend inspected read-only at `/home/simonwjackson/code/sandbox/forgerie`, HEAD `ec6ed17f83b66315061ab00f3be36f60bc383176`. The new-client worktree was at `84cae705`. Installed `@earendil-works/pi-coding-agent` is `1.1.0`. Git is `2.53.0`.

Eight local checks passed against the installed SDK and real disposable Git repositories. See [probe](virtual-project-costs/probe.mjs) and [results](virtual-project-costs/results.json). They made no model requests and changed no live session, project, repository, or service data. They are not end-to-end Forgerie acceptance tests.

Run again from the new-client worktree:

```sh
verification/virtual-project-costs/probe.mjs /home/simonwjackson/code/sandbox/forgerie/node_modules/@earendil-works/pi-coding-agent
```

The script uses a Nix shebang and deletes its temporary fixtures. The dependency path is explicit because the client worktree does not contain the backend SDK.

The eight checks passed again after the external-source review. The new-client `npm run verify` also passed: build, lint, and 1,013 tests across 104 files. The build emitted dependency annotation warnings. This verifies the unchanged client baseline, not multi-repo feature parity. No new UI behavior was introduced.

## 1. Landing

### What the existing code does

`SessionWorktrees.land()` checks the session checkout, rebases onto the default branch, checks the main checkout again, then runs `git merge --ff-only`. It stores a landed receipt and starts cleanup. Its lock is per repository inside the running service. It is not a lock observed by arbitrary shell Git commands. [F1]

The local probe rebased two independent repos successfully. It then added a concurrent commit to repo B's main branch. Repo A fast-forwarded successfully; repo B's fast-forward failed. Repo A remained landed. This verifies that a successful preflight does not imply an atomic group landing.

### What Git actually guarantees

Git 2.53.0 documents `update-ref --stdin` transactions with `start`, `prepare`, `commit` and `abort`. The command verifies expected old object IDs and locks references before updating them. This operates on the current repository's references, not a set of independent repositories. The manual also warns that "a concurrent reader may still see a subset of the modifications." Do not promise simultaneous visibility even for that ref transaction. [G1]

`git push --atomic` says: "Either all refs are updated, or on error, no refs are updated." Its documented target is a remote repository. This does not supply a multi-repository transaction. If the server does not support atomic pushes, the command fails. The failed researcher's supposed quote about "group pushes" is absent from the inspected 2.53.0 manual and is not used as evidence. [G2]

Reference updates are not a replacement for updating a checked-out working tree and index. Do not replace Forgerie's fast-forward merge with `update-ref` alone to claim transactional landing. Expected-old-ID checks protect a particular ref update; checking all repos beforehand is still not a global lock. [G1, G3, F1]

Conclusion: native Git does not provide the required all-or-nothing operation across independent repos. This is the scope of the documented commands, not a claim that no custom storage or release system can coordinate multiple components.

### Recommended behavior, not implemented

Record the participating repositories and exact revisions. Prepare and test the whole set before advancing any main branch. Recheck for changes, then advance each repository with a durable per-repo operation record. Distinguish a stale preparation, a landed repo, a failed repo, and pending cleanup. On restart, inspect actual Git state before retrying. A crash can occur between a Git operation and the receipt write.

Keep the worktrees until recovery no longer needs them. Offer per-repo Land and a coordinated Land-all action. Do not describe Land-all as a transaction. If one repo lands and another fails, report that state and resume safely. Do not automatically reset a landed main branch: someone else can already have consumed it or committed on top of it.

Cost: persistent coordination state, interrupted-operation tests, and visible partial outcomes. Git commits, hosted PR merges, and deployment remain separate operations. A deployment that triggers after each repo changes needs its own release coordination. This research did not audit every hosting platform's merge API.

An optional release design can publish one manifest that pins the tested commit of each repo. Consumers then select a complete revision set through that manifest. This does not make the underlying repo updates atomic. Its cost is changing builds and releases to consume the manifest, and retaining all referenced commits.

## 2. Setup

The current `SessionWorktrees.create()` creates one worktree and runs that repository's post-create hook. It retains failed setup state and supports retry. The hook is optional. [F1, F2]

The local probe confirms that a linked worktree shares its repository's common Git directory but has its own index. It is not a complete independent clone. It still needs checkout files and whatever mutable build state its tools require.

The earlier npm example was hypothetical. No `.forgerie/hooks` directory existed at the inspected KORI root. This research did not run KORI builds, install packages in KORI, or measure startup time.

Recommendation: keep all intended repositories available, use bounded parallel preparation where hooks are independent, and preserve existing package/build caches. Keep readiness and retry state per repository. Do not force users to select fewer repos merely to avoid an unmeasured cost.

Cost: concurrency competes for CPU, memory, disk and network. Hooks can contend for shared ports, databases or external services. Hook dependencies need ordering. Lazy setup can reduce initial waiting but moves failures and delays to first use. It is an explicit behavior choice, not a free optimization.

### Which work can be reused

| Mechanism | Verified source behavior | Residual cost or risk |
|---|---|---|
| Git worktrees | Linked worktrees share repository data except per-worktree files such as `HEAD` and `index`. [G3] | Each repo still has its own history. Checkout files and mutable outputs remain per worktree. This is not constant storage for N unrelated repos. |
| npm | `npm ci` removes an existing `node_modules` before installation. npm's `_cacache` stores HTTP/package data and checks integrity. [C1, C2] | Warm cache can avoid repeated downloads, not all installation or lifecycle-script work. Cached data is not guaranteed to remain available. |
| pnpm | `packageImportMethod` supports hardlink, copy, clone and clone-or-copy. Cloning preserves independent modifications; cross-filesystem hardlinking falls back to copies. [C3, C4] | Hardlinked files share mutations. Filesystem support and package import mode matter. No blanket claim that pnpm either always shares writes or always isolates them is correct. |
| Nix | Store objects are immutable in Nix's model. A store path identifies an object; realisation fetches or builds missing objects. GC roots retain required paths. [C5–C8] | Reuse requires the same store objects to exist. Different inputs can require new outputs. Evaluation, project-local outputs and uncached builds still cost time. Immutability is not proof that a privileged process cannot corrupt storage. |

These are reuse mechanisms, not benchmark results. Neither npm nor pnpm nor Nix establishes a universal N-times startup penalty or a zero-cost startup guarantee. The source docs do not justify changing KORI's package manager for this feature.

Recommendation: reuse each repo's current supported cache mechanism first. Measure worktree creation, dependency preparation and build time separately, with cold and warm caches. Add bounded concurrency only after identifying shared resources.

Cost: measurement and cache invalidation rules. A reusable build output must match its inputs, platform and relevant build settings. Do not share mutable `node_modules` or build directories blindly between sessions. A cache is not the same as a writable shared working environment.

## 3. Instructions, settings and extensions

### Verified discovery behavior

Pi treats context files and `.pi` configuration differently. Context files load from the agent directory, current directory and its ancestors. Project `.pi` configuration is rooted at the current working directory. The earlier answer incorrectly grouped both mechanisms under ancestor discovery. [P1, P2]

A session started above `repo-a` and `repo-b` does not automatically load their child `AGENTS.md` files. The probe verified that. The SDK already exposes `agentsFilesOverride`, extra resource paths, and skill/prompt overrides. Forgerie already uses resource overrides for its bundled skills and extensions. [P2, F3]

The probe loaded both member instruction files through `agentsFilesOverride`, preserving their original paths. This verifies the loading mechanism, not that a model always follows the right scope. Simply concatenating instructions with contradictory rules does not establish precedence.

### Resources can remain available

Two different skills named `check` yielded one visible skill and one collision diagnostic. This is existing Pi behavior, not a theoretical conflict. Loading each member separately and supplying qualified names through `skillsOverride` retained both skills in a second check. [P3]

Recommendation: retain each repo's instructions and resource origin. Make same-name skills and prompts explicitly addressable by repository. Preserve their source paths and relative-resource context. Do not silently let discovery order hide a feature.

Cost: qualified invocation needs client and agent-tool support. Hardcoded references to old skill names need compatibility rules. The probe did not test slash commands or every skill's internal links.

### Some settings are session-wide

The probe created different default-model settings in each member. Reading settings from the parent did not merge either member. Applying a bundle-level override worked, but `reload()` discarded the in-memory override. The existing Durable adapter reloads settings and resources, so a new policy must survive that path. [P4, F4]

Recommendation: one explicit virtual-project/session policy for the model, thinking level, compaction, provider selection and other session-wide choices. Keep repository build commands, environments and local instructions scoped to that repository. Resolve relative resource paths against the directory that declared them.

Cost: one generation cannot simultaneously use two different default models. Keeping access to both choices is possible; applying both defaults at once is not meaningful. This is a selection rule, not the loss of model switching.

### Extensions are the difficult case

Pi extension loading uses one runtime cwd. Duplicate tool/flag registrations produce diagnostics, with precedence handled by load order. Forgerie's Durable runtime also constructs its extension runner and SDK tools with one cwd. [P2, F4]

Adding several extension directories is not proof of multi-repo compatibility. An extension can assume cwd is a Git root, keep process-global state, register a conflicting tool, or execute code on load.

Recommendation: load app-wide extensions once; audit repo-specific extensions before combining them. Require explicit repository selection for Git/PR tools. Use adapters or separately scoped execution only where required. Preserve existing trust requirements rather than automatically trusting every member's executable configuration.

Cost: arbitrary extension behavior cannot be made compatible by simply renaming tool registrations. Isolation adds runtime and routing complexity. Full "no feature loss" remains an acceptance requirement, not a verified promise.

## 4. Session identity, storage and cleanup

Pi's `SessionManager.create(cwd, sessionDir)` accepts an explicit session directory. The probe persisted a session at a non-Git parent cwd, reopened it with the same ID and cwd, and found it through listing. [P5]

Forgerie's gateway already resolves environment-configured or settings-configured session directories before its default cwd-encoded layout. It then filters and resolves sessions using their stored cwd. The Durable journal stores SQLite state relative to the JSONL session-file path. Moving session files casually can therefore separate them from their checkpoints. [F5, F6]

The real missing work is ownership:

- `RegisteredProjectWorkspaceCwds` associates sessions with projects through workspace-path equality. A bundle root needs explicit membership. [F7]
- `SessionWorktrees.attach()` requires the session cwd to equal its single owned worktree path. A bundle needs ownership of multiple member worktrees. [F1]
- Transcript preservation selects sessions whose cwd lies inside the worktree being removed. A parent bundle cwd does not meet that condition. The existing cleanup code must not be reused unchanged. [F8]
- Forgerie already supports non-Git project folders. The earlier statement that every project or session necessarily has one repo was inaccurate. [F9]

Recommendation: give the bundle a stable identity and root path, separate from its display name. Persist a snapshot of its member repos/worktrees for each session. Leave existing single-repo sessions and storage paths unchanged. Add explicit bundle membership and ownership rather than rediscovering it from arbitrary path containment.

Cost: migration/compatibility tests and cleanup rules. Removing one completed member must not erase the parent transcript or incorrectly make the entire session read-only. If some members are no longer present, resume must report that state rather than silently substituting another checkout.

## An additional cost: testing the actual combination

Importance: high. Putting repositories beside each other does not make one build consume the other's local changes.

KORI's `flake.nix` at commit `4b310752f4f7be4e565e2023d4a4e6f61c5df94b` declares `proseql` using a pinned GitHub revision. That is one concrete example of an external dependency reference. This does not establish that `proseql` belongs in the requested virtual project. [K1]

Recommendation: a cross-repo test must record which member revisions it uses and how local dependency overrides are supplied. Validate the combination intended for landing and release.

Cost: repository-specific test/build wiring and potentially ordered releases. Per-repo green tests alone do not prove that a cross-repo change works together. No integration build was run in this research.

## Acceptance needed before calling this feature-complete

| Area | Required evidence |
|---|---|
| Basic session | One conversation edits and tests two member repos while preserving repo identity. |
| Setup | A failed member hook leaves other members intact and retries without duplicate worktrees. |
| Instructions/resources | Same-name skills remain reachable; instruction scope and settings survive reload and restart. |
| Extensions/tools | Git, PR, backlog and custom extension calls select the intended repo, including equal PR numbers in two repos. |
| Landing | Conflicts, concurrent updates and crashes before/after each Git operation recover without losing changes. |
| Cleanup | Partial Land/Discard and shared child sessions preserve transcripts, Durable state and remaining worktrees. |
| History | Resume, tree/fork, handoff, delegated agents, attachments and existing single-repo sessions retain their current behavior. |
| Tests/release | Integration tests use the intended local revision set; publication does not assume an atomic multi-repo merge. |
| New client | Existing capabilities stay reachable across all required postures. No legacy-client implementation is required. |

## Local and SDK sources

Backend references below are source inspection at the recorded commit, not claims that the feature is implemented. Paths are relative to `/home/simonwjackson/code/sandbox/forgerie`.

- F1: `src/server/workspaces/sessionWorktrees.ts`, `options`, `create`, `attach`, `land`, `archiveCleanup`, `remove`, `exclusive`.
- F2: `src/server/workspaces/worktreeHooks.ts`, `runWorktreeHook` and optional executable-hook detection.
- F3: `src/server/sessions/piSessionService.ts`, `createDefaultRuntimeFactory`, lines 838–882.
- F4: `src/server/sessions/durableAgentSession.ts`, runtime construction, `promptOptions`, `reload`.
- F5: `src/server/sessions/piSessionManagerGateway.ts`, `SessionDirResolver`, `create`, `list`, `resolveSessionFileInDir`, `sessionDirInDefaultPiStore`.
- F6: `src/server/sessions/durableSessionJournal.ts`, `durableSessionPaths`, `DurableSessionJournal.open`.
- F7: `src/server/workspaces/projectWorkspaceCwds.ts`, `RegisteredProjectWorkspaceCwds.forCwd`.
- F8: `src/server/workspaces/sessionWorktreeStore.ts`, `forSession`, `assertWritable`, `saveTranscripts`, `worktreeRecordForSession`.
- F9: `src/server/workspaces/workspaceService.ts`, `list` and `single`.
- P1: [Pi 1.1.0 configuration documentation](https://unpkg.com/@earendil-works/pi-coding-agent@1.1.0/docs/configuration.md), read from the installed package.
- P2: [Pi 1.1.0 resource loader](https://unpkg.com/@earendil-works/pi-coding-agent@1.1.0/dist/core/resource-loader.js), `loadProjectContextFiles`, constructor options, `reload`, `addExtensionConflictDiagnostics`, `detectExtensionConflicts`; also its adjacent `resource-loader.d.ts`. Read locally and probed where stated.
- P3: [Pi 1.1.0 skills loader](https://unpkg.com/@earendil-works/pi-coding-agent@1.1.0/dist/core/skills.js), `loadSkills`, plus `resource-loader.js` prompt deduplication.
- P4: [Pi 1.1.0 settings manager](https://unpkg.com/@earendil-works/pi-coding-agent@1.1.0/dist/core/settings-manager.js), `create`, `reload`, `applyOverrides`.
- P5: [Pi 1.1.0 session manager](https://unpkg.com/@earendil-works/pi-coding-agent@1.1.0/dist/core/session-manager.js), `getDefaultSessionDirPath`, `create`, `open`, `list`.
- K1: `/home/simonwjackson/code/sandbox/korri/flake.nix`, lines 13–16, inspected read-only at the recorded commit.

## External primary sources

These documents were fetched and read directly by the parent after the user approved continuation. Git documentation is pinned to the installed Git version. npm and pnpm pages are the published documentation read on the research date, not an assertion that those tool versions are installed in KORI.

- G1: [Git 2.53.0 update-ref manual](https://raw.githubusercontent.com/git/git/v2.53.0/Documentation/git-update-ref.adoc), expected old object IDs, transaction commands and concurrent-reader caveat.
- G2: [Git 2.53.0 push manual](https://raw.githubusercontent.com/git/git/v2.53.0/Documentation/git-push.adoc), DESCRIPTION and `--atomic`. It defines a push to a remote repository.
- G3: [Git 2.53.0 worktree manual](https://raw.githubusercontent.com/git/git/v2.53.0/Documentation/git-worktree.adoc), COMMANDS/add, REFS and DETAILS. It states: "sharing everything except per-worktree files such as HEAD, index, etc."
- C1: [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci), Description. "If a node_modules is already present, it will be automatically removed before npm ci begins its install."
- C2: [npm cache](https://docs.npmjs.com/cli/v11/commands/npm-cache), Details and cache-design note. The cache is content-addressable but is not guaranteed persistent storage.
- C3: [pnpm packageImportMethod](https://pnpm.io/settings/node-modules#packageimportmethod), clone/copy/hardlink behavior. "When cloning is used, you may edit files in your node_modules and they will not be modified in the central content-addressable store."
- C4: [pnpm store settings](https://pnpm.io/settings/store), cross-filesystem copies and shared-store trust requirements. Integrity verification does not make a store writable by untrusted users safe.
- C5: [Nix 2.28 store paths](https://nix.dev/manual/nix/2.28/store/store-path.html), opaque object identity. Digest calculation depends on the store-path type; not every Nix object is content-addressed in the same way.
- C6: [Nix 2.28 store objects](https://nix.dev/manual/nix/2.28/store/store-object.html), Immutability and closure property.
- C7: [Nix 2.28 realisation](https://nix.dev/manual/nix/2.28/command-ref/nix-store/realise), substitution, building and `--add-root`.
- C8: [Nix 2.28 garbage collection](https://nix.dev/manual/nix/2.28/package-management/garbage-collection.html), roots and retained dependencies.

## Research execution record

The background researcher run `6860cc1f-4f38-4bf5-9485-c71c8cf6b70d` ended in `failed` state. Its exact infrastructure error was:

```text
Agent 'researcher' requested unavailable child tools: fetch_content, get_search_content, source_check.
```

The run was launched in `/home/simonwjackson/code/sandbox/forgerie/.worktree/new-ui-mvp`, branch `new-ui-mvp`, initially at `84cae705`. The worktree advanced independently to `563690959fc14816d22034d299421704af8a2941` during research. No production source changes came from this investigation. At the blocker check, its untracked outputs were this report and `verification/virtual-project-costs/`. Pre-existing `.forgerie/` and `.pi-web/` files were left untouched.

The child left `/tmp/forgerie-multirepo-external-research.md`, but that artifact is not accepted primary-source evidence. It contains overstatements about linear setup time, rollback safety, and immutable-store guarantees. Its claims were not adopted without direct verification.

Run artifacts: `/tmp/pi-subagents-uid-1000/async-subagent-runs/6860cc1f-4f38-4bf5-9485-c71c8cf6b70d`. The user then approved continuing directly. The parent read the sources listed above; no replacement child was launched.

Remaining uncertainty: KORI setup performance, its final member list, arbitrary extension compatibility, hosted merge-platform details and end-to-end Forgerie feature parity. The evidence supports the classifications in this report, not a production-readiness claim. No production behavior changed. No deployment is needed for this report.
