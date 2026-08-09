---
title: "feat: First-class pi-processes support in Forgerie"
type: feat
status: completed
date: 2026-08-07
completed: 2026-08-08
verify_command: "npm run verify"
---

# feat: First-class pi-processes support in Forgerie

> **Architecture correction — 2026-08-08:** The Mountainous/Nix packaging decision in this historical plan was wrong. Forgerie is a self-contained application. It now owns and ships the patched package under `vendor/pi-processes`; U3 and later Mountainous references below describe the superseded implementation, not the current product boundary.

**Target repos:** this repo (`forgerie`) for product work; `mountainous` (the user's NixOS configuration repo at `code/github/simonwjackson/mountainous`) for U3 packaging; a new local fork checkout of `aliou/pi-processes` for U1–U2. Paths below are repo-relative to the repo named in each unit, except explicitly user-local `~` paths in operational units (U4).

## Summary

Make agent-managed background processes reliable and visible in Forgerie: root-cause and patch pi-processes' broken NixOS spawn environment in a Nix-maintained local fork, enforce process-tool usage deterministically via the plugin's own interception hook, render `ad-process:notification` transcript entries from structured details instead of raw XML, and add a live processes panel backed by a first-party bridge extension that speaks pi-processes' existing EventBus protocol.

---

## Problem Frame

Models claim to start servers that are dead moments later. Live validation in the Forgerie web UI proved the causes: `&`-backgrounded processes die of EPIPE/timeout kills, and the correct primitive — the pi-processes `process` tool — spawns through `bash -lc`, which on NixOS rebuilds `PATH` and loses the daemon's toolchain. The config-only `execution.shellPath` fix failed validation (intermittent fallback to hard-coded system bash; root cause unknown). Meanwhile pi-processes is invisible in the web UI: its TUI dock and viewers cannot render, and its notifications appear as raw model-facing XML. The user requires product-owned, deterministic fixes — no reliance on global `AGENTS.md` prompt guidance — and a locally maintained patch via Nix, since `@aliou/pi-processes` is not in nixpkgs and no upstream PR will be made.

---

## Requirements

- R1. A managed process started via the `process` tool in a Forgerie session finds the daemon's curated toolchain (`node`, `python3`, `git`, `curl`) on `PATH`, deterministically — every spawn, not intermittently.
- R2. The spawn-environment fix is a locally maintained patch on `@aliou/pi-processes`, built and pinned via Nix, installable declaratively; no upstream PR, no hand-edited `node_modules`.
- R3. Shell background patterns (`&`, `nohup`, `setsid`, `disown`) in bash tool calls are blocked deterministically and redirected to the `process` tool (pi-processes' `interception.blockBackgroundCommands`), in both Forgerie and the TUI.
- R4. `custom` transcript messages with `customType: "ad-process:notification"` render as compact cards built from structured `details` (summary, process name, kind/status, exit code where present), with raw content behind a disclosure; unknown customTypes and malformed details fall back to raw text exactly as today.
- R5. A workspace panel lists the selected session's managed processes (name, status, pid, uptime, recent logs) with stop and stdin-write actions, updating live while processes start, log, and exit.
- R6. The panel and renderer pass the Fold 8 four-posture visual validation (499×789, 789×499, 739×979, 979×739) per AGENTS.md.
- R7. The panel distinguishes "no processes" from "pi-processes not loaded in this session", and recovers correctly after `/reload`, WebSocket reconnect, and daemon restart (no stale "running" rows).

---

## Scope Boundaries

- No generic bridging of pi TUI widgets (`ctx.ui.setWidget`, `ctx.ui.custom`) to the browser — proven non-serializable; the panel is a fresh browser-native surface.
- No first-class pi-subagents work (separate future initiative).
- No upstream PRs to `aliou/pi-processes`; no public fork publishing.
- No global-`AGENTS.md` prompt guidance as an enforcement mechanism.
- The Lighthouse/PWA backlog item (`01KZF6AACJ2TWKYKTR53PKHKKJ`) is not part of this plan.
- Aggregating processes across multiple sessions of one workspace is out of scope for v1 — the panel is scoped to the selected session (see Key Technical Decisions).

### Deferred to Follow-Up Work

- Compact renderers for other extensions' custom message types (subsession notifications already have one; survey findings beyond `ad-process:*` become future registry entries): future iteration on the renderer registry.
- Panel affordance to start *new* processes from the browser: future iteration once read/stop/write is proven.

---

## Context & Research

### Relevant Code and Patterns

- `src/client/src/chatMessages.ts` — `normalizeMessage()`/`askUserRecordPart()` (~line 197): the established intercept pattern for `role:"custom"` + `customType` + `details` → typed `ChatPart`, with `undefined` fallback to raw text. Template for the new projection.
- `src/client/src/components/shared.ts` — `ChatPart` union: extension point for a new part discriminant.
- `src/client/src/components/ChatView.ts` — `renderPart()`: single render dispatch; add the card branch here.
- `pi-web-plugins/workspace-tasks/` — exemplar plugin: `pi-web-plugin.ts` manifest (`apiVersion: 1`, `activate()`, `workspacePanels` contribution), `tasksPanelElement.ts` (native custom element, shadow DOM, `set context(value)` with cache-key guard, `connectedCallback`/`disconnectedCallback`).
- `src/client/src/plugins/registry.ts`, `src/client/src/plugins/types.ts` — plugin registration and `WorkspacePanelContext`.
- `plugin-api/unstable.d.ts`, `src/plugin-api/unstable.ts` — the `piWebUnstable` escape hatch; precedent: `terminalCommandRuns`.
- `src/server/sessions/piSessionService.ts` — `sessionUiContext()` proxy (~line 3110), `SessionEventHub.publish` patterns, custom-message forwarding (~line 4216: `content`, `customType`, `details` all reach the client already).
- `src/shared/apiTypes.ts` — `SessionUiEventBody` union and `ASK_USER_ANSWERS_CUSTOM_TYPE`; new event variants and the notification details type go here.
- `src/server/sessiond/sessionProxyRoutes.ts` — wildcard proxying of `sessions/*`; new routes under `/api/sessions/:sessionId/…` are proxied to remote machines for free.
- pi-processes internals (read from `~/.pi/agent/npm/node_modules/@aliou/pi-processes`, pin into the fork): `src/utils/command-executor.ts` (`spawn(shell, ["-lc", command], { env: process.env })` and `DEFAULT_KNOWN_SHELL_PATHS` fallback), `src/protocol/` (`CHANNELS`, `REQUEST_LIST/GET/OUTPUT/CONFIG`, `ProcessesStarted/Changed/Ended/OutputChanged` broadcasts, `CommandKillPayload`), `extensions/processes/hooks/background-blocker.ts` (`interception.blockBackgroundCommands`), `extensions/processes/handlers/notifications.ts` (`ad-process:notification` emission).
- `mountainous` repo: `features/pi/` (existing pi feature module wrapping `pi.nix`), `packages/` auto-collected by `collectPackagePaths` in `flake.nix`, `AGENTS.md` rule "git add new files immediately — Nix flakes only see git-tracked files".
- `testing-guide` project skill: happy-dom opt-in per file, TemplateResult handler extraction, no Mock/Stub/Fake naming, `<unit>.testSupport.ts`.

### Institutional Learnings

- Server already forwards `customType` + `details` for displayed custom messages — the raw-XML problem is client-side only (measured: 37/37 notifications carry structured details; `details.summary` ≈ 5.8× smaller than raw content).
- `ctx.hasUI` is `true` in Forgerie yet `ui.custom`/widgets are no-ops — never gate on `hasUI` alone.
- Systemd user units on NixOS need explicit `Environment=PATH=`; login shells rebuild `PATH` from `/etc/set-environment` and clobber unit-curated values. This is the confirmed mechanism behind the `process` tool's exit-127 failures.
- Live validation evidence (this session): config-only `shellPath` was honored by some spawns and ignored by others within one daemon — one of five probes used the configured wrapper; the rest used the `DEFAULT_KNOWN_SHELL_PATHS` fallback with a login-shell `PATH`. Root cause not yet established; U1 exists because of this.

### External References

- None used — local patterns and live investigation were sufficient; pi-processes is not in nixpkgs (verified via `nix search`).

---

## Key Technical Decisions

- **Fork-and-patch via Nix, not config-only and not hand-edits**: the config path (`execution.shellPath`) demonstrably fails intermittently, and `node_modules` edits are erased by `pi update`. A pinned Nix build of a patched fork is deterministic and declarative. (User-confirmed.)
- **Patch scope — spawn environment**: replace `bash -lc` + silent multi-path fallback with a non-login spawn that inherits the daemon's curated `process.env`, and make shell resolution fail loudly instead of silently degrading. Exact patch shape follows U1's root-cause finding.
- **Patch scope — stdin-write channel**: pi-processes' EventBus protocol has `KILL`/`CLEAR`/`PIN` commands but no stdin-write; the panel's write action requires adding a `COMMAND_WRITE` channel to the fork. Kept minimal and additive for patch maintainability.
- **Bridge is a first-party pi extension, not a deeper fork**: extensions in one session share the pi `EventBus`, and sessions run in-process with sessiond. A small Forgerie-owned bridge extension loaded into each session speaks the existing pi-processes protocol (list/output/kill/broadcasts) — no fork changes needed for data access, and the fork patch stays small.
- **Request path is synchronous in-process; updates stream over the existing session WebSocket**: browser → `/api/sessions/:sessionId/processes/*` HTTP routes → sessiond → bridge → EventBus request handlers (synchronous reply); `ProcessesStarted/Changed/Ended/OutputChanged` broadcasts → new `SessionUiEvent` variants → existing per-session socket. No new socket, and remote machines work via the existing wildcard proxy.
- **Panel scope: selected session only (v1)**: processes are session-scoped, panels are workspace-scoped; v1 shows the selected session's processes with the session identity in the panel header, and an explicit state when no session is selected. Cross-session aggregation deferred.
- **Renderer dispatches strictly on `customType`**: never on details shape; known-type-with-malformed-details falls back to raw content, mirroring `parsedAskUserRecord`. Protocol constants and the details schema are pinned in Forgerie from pi-processes source, with strict parsers that degrade to fallback rendering rather than crashing.
- **Enable `blockBackgroundCommands` only after the spawn fix is validated** (U4 last in the runtime track): blocking `&` while the redirect target is broken would make things worse.
- **Nix packaging lives in `mountainous`** as a package + small home config so installation is per-host declarative; pi's `settings.json` installs the built package by absolute path (a one-time manual settings change, documented in U3).
- **Process-route trust boundary (default, flagged for user review):** the kill/write routes rely on the Tailscale perimeter exactly like every other Forgerie route — consistent with the product identity ("no auth layer of its own"). If that is ever revisited, it is revisited product-wide, not per-route.
- **Fork scope budget:** the private fork is capped at two concerns — the spawn-environment fix and the additive `COMMAND_WRITE` channel. Any further divergence requires explicit reassessment; if `COMMAND_WRITE` proves invasive during U2, stdin-write is deferred and the panel ships read+stop first (the `writeSupported` flag already tolerates this).
- **Background-command escape hatch:** shell backgrounding is intentionally unsupported once interception is on; the escape hatch is pi-processes' own config (`interception.blockBackgroundCommands` in user or project scope), documented in U4 — no new mechanism is built.

---

## Open Questions

### Resolved During Planning

- Can the panel bridge reach pi-processes state without forking it?: Yes — the request/broadcast protocol on the shared EventBus (`src/protocol/channels.ts`) is designed for sibling extensions (the dock/logs extensions already use it); a Forgerie bridge extension is just another sibling.
- Panel data transport: reuse the existing per-session WebSocket and add typed `SessionUiEvent` variants; HTTP for request/response. No new transport.
- Multi-session workspaces: selected-session scope for v1 (flow analysis Q-B1 default).
- Extension-absent vs. empty: bridge reports availability explicitly; panel renders distinct states (flow analysis Q-B5).

### Deferred to Implementation

- **Root cause of intermittent `shellPath` honoring**: unknown; U1 answers it before the patch is finalized. Candidate hypotheses to test: per-session extension instances loading config at different times; multiple manager instances (three extensions in the package); a second spawn call-site that bypasses `resolveShellExecutable`; config-scope merge (`global`/`local`/`memory`) differences between sessions.
- **Exact `details` schema for `ad-process:notification`**: pin from `extensions/processes/handlers/notifications.ts` + `notification-sender.ts` at the fork's pinned version during U5; all fields optional in the parser (log-match notifications carry no exit code).
- **Whether pi supports first-party extension injection per session via config or requires the bridge to be installed as a profile package**: resolve in U6 from pi SDK docs/source; either path works (profile package is the fallback).
- **Nix build mechanics for the fork's dependencies** (`@aliou/pi-utils-*`): `buildNpmPackage` with `npmDepsHash` is the default; if the runtime resolves dependencies from the pi profile's shared `node_modules` instead, packaging simplifies — verify in U3.

---

## Implementation Units

Two tracks. Runtime track: U1 → U2 → U3 → U4. Product track: U5 fully independent; U6 starts after U2 (protocol additions) with its write-path verification gated on U3/U4 (patched fork installed); U7 follows U6. U8 closes both.

### U1. Root-cause the intermittent shellPath application

**Goal:** Establish, with evidence, why one pi-processes manager honored `execution.shellPath` for some spawns and fell back to hard-coded system bash for others — so the U2 patch fixes the disease, not a symptom.

**Requirements:** R1

**Dependencies:** None

**Files:** (fork checkout, read/instrument only)
- Read: `src/utils/command-executor.ts`, `src/manager/process-runtime-controller.ts`, `src/manager/index.ts`, `extensions/processes/index.ts`, `extensions/processes/config/loader.ts`
- Read: `@aliou/pi-utils-settings` `src/config-loader.ts` (scope merge, `load()` timing)

**Approach:**
- Reproduce against a local checkout loaded into a test pi session, **including the Forgerie web-session path** (the failure was observed through sessiond; TUI-only evidence does not close this unit), with logging on `resolveShellExecutable` inputs/outputs and `configLoader.getConfig()` state per spawn.
- Test the candidate hypotheses from Open Questions; also check whether Forgerie's per-session extension instances each hold independent `configLoader` singletons with different load timing.
- Record the finding in the fork's patch notes (it drives whether the fix is "config plumbing" or "remove the fallback entirely").

**Test scenarios:**
- Test expectation: none — diagnostic unit; its output is a documented root cause plus a reproducible failing observation to be turned into a regression test in U2.

**Verification:**
- A written root-cause statement that explains both observed behaviors (wrapper honored vs. fallback used) and predicts them reproducibly.

---

### U2. Create the patched pi-processes fork

**Goal:** A local fork of `aliou/pi-processes` (pinned to the installed release tag) carrying the minimal patch set: deterministic non-login spawn inheriting the daemon environment, loud shell-resolution failure, the U1 root-cause fix, and an additive `COMMAND_WRITE` protocol channel for the panel.

**Requirements:** R1, R2, R5 (write action's protocol prerequisite)

**Dependencies:** U1

**Files:** (new fork checkout, e.g. `code/github/simonwjackson/pi-processes`; paths repo-relative to the fork)
- Modify: `src/utils/command-executor.ts` (spawn: drop `-l`, inherit env; resolution: configured path or hard error — no silent `DEFAULT_KNOWN_SHELL_PATHS` walk when a shell is configured)
- Modify: whatever U1 implicates (e.g. `extensions/processes/config/loader.ts` plumbing)
- Modify: `src/protocol/channels.ts`, `src/protocol/commands.ts`, `extensions/processes/handlers/commands.ts` (additive `COMMAND_WRITE` with payload `{ processId, input, endStdin? }`, reusing the manager's existing stdin-write capability)
- Create: `PATCHES.md` at the fork root — every divergence from upstream, why, and the U1 root-cause record

**Approach:**
- Fork = upstream clone + a small commit series on a branch; each concern its own commit so upstream rebases stay tractable.
- Spawn env: inherit `process.env` as today but stop letting a login shell rewrite it; do not invent a Forgerie-specific env contract inside the plugin.
- Keep the diff minimal — no refactors, no formatting churn.

**Patterns to follow:**
- Upstream's own test layout (`vitest`, e2e config) — add regression tests beside existing ones.

**Test scenarios:**
- Happy path: spawn with configured shellPath → child's `PATH` equals the parent process env `PATH` (no login-shell rewrite) — PATH equality is the acceptance check for the whole R1 toolchain (`node`, `python3`, `git`, `curl`); a command resolving `node` from parent `PATH` exits 0.
- Happy path: `COMMAND_WRITE` to a running process delivers input to stdin; with `endStdin` closes it.
- Error path: configured shellPath missing on disk → spawn fails loudly with a descriptive error (no silent fallback).
- Error path: `COMMAND_WRITE` to an exited process → error reply, no crash.
- Regression: the U1 root-cause scenario, encoded as a test that fails on upstream and passes on the fork.
- Edge case: no shellPath configured → documented fallback behavior still works (fallback list retained only for the unconfigured case).

**Verification:**
- Fork test suite green; the U1 reproduction now behaves deterministically across repeated spawns in a real pi session.

---

### U3. Package and install the fork via Nix (mountainous)

**Goal:** The patched fork is built by Nix, pinned, installed declaratively on zao, and consumed by pi from a stable path — surviving `pi update` and garbage collection.

**Requirements:** R2

**Dependencies:** U2

**Files:** (`mountainous` repo)
- Create: `packages/pi-processes-patched/default.nix` (auto-collected by `flake.nix` `collectPackagePaths`)
- Modify: `features/pi/default.nix` + `features/pi/nixos.nix` (or host `hosts/zao/default.nix`) — expose the package at a stable per-user path (e.g. via `home.file` or an `environment` symlink) with a GC root
- Create: brief docs in the package dir README covering the one-time `~/.pi/agent/settings.json` edit: replace `npm:@aliou/pi-processes` with the stable installed path

**Approach:**
- Source: the local fork checkout via a pinned flake input (`flake = false`) per mountainous convention "prefer flake inputs over fetchurl", or `fetchGit` of the fork; pin the exact rev.
- Dependencies: default to `buildNpmPackage` (`npmDepsHash`) producing a complete package dir with production `node_modules`; if U3 verification shows pi resolves plugin dependencies itself, simplify to a source-only derivation.
- The stable path must be identical across rebuilds (symlink indirection), so `settings.json` never needs re-editing.
- Follow the AGENTS.md rule: `git add` new files before building.

**Test scenarios:**
- Test expectation: none in CI — verification is operational (below). Mountainous's `just test` must still pass.

**Verification:**
- `just build` (or `just test`) green in mountainous; after switch, the stable path exists and contains the patched `command-executor`; `pi` loads the extension from the path (visible in `pi doctor` / extension list); `pi update` does not revert the patch; the TUI `process` tool still works.

---

### U4. Enable deterministic interception and validate the runtime end-to-end

**Goal:** With spawning fixed, flip `interception.blockBackgroundCommands` on and prove the full runtime story live in both frontends.

**Requirements:** R1, R3

**Dependencies:** U3

**Files:**
- Modify: `~/.pi/agent/extensions/processes.json` (user config, not repo-tracked): remove the now-obsolete `execution.shellPath` wrapper entry; set `interception.blockBackgroundCommands: true`
- Modify (this repo): `AGENTS.local.md` — record the new operational reality (patched fork path, interception on, wrapper retired); remove the stale wrapper artifact `~/.local/share/forgerie/pi-process-shell` and its GC root

**Approach:**
- Restart `forgerie-sessiond` (kills active runs — schedule deliberately), then run the validation matrix in a live web session and a TUI session.

**Test scenarios:** (live validation matrix, not unit tests; every row runs in both the web UI and the TUI)
- Happy path: `process start` of a `node`-dependent server → running, answers HTTP, survives turn end; logs readable via `process output`.
- Happy path: one managed command resolves each of `node`, `python3`, `git`, `curl` (R1 toolchain).
- Happy path: stdin write through the tool to a running process.
- Error path: bash tool calls containing trailing `&`, `nohup`, `setsid`, and `disown` → each blocked with the redirect message (R3 pattern set).
- Edge case: repeated spawns (≥5) all resolve `node` — the intermittency from U1 is gone.
- Edge case: daemon restart kills managed processes; `process list` after restart is empty (documented, expected).

**Verification:**
- All matrix rows pass in both frontends; the exit-127 failure mode is unreproducible; interception provably blocks all four background patterns.

---

### U5. Render ad-process notifications from structured details

**Goal:** `ad-process:notification` messages render as compact cards from `details`; raw content sits behind a disclosure; everything else falls back exactly as today. (Absorbed backlog item `01KZF4JF…`.)

**Requirements:** R4, R6

**Dependencies:** None (independent of the runtime track)

**Files:** (this repo)
- Modify: `src/shared/apiTypes.ts` (pin `AD_PROCESS_NOTIFICATION_CUSTOM_TYPE` and the details type with all-optional fields)
- Modify: `src/client/src/chatMessages.ts` (projection: `processNotificationPart()` beside `askUserRecordPart()`; new `ChatPart` discriminant in `src/client/src/components/shared.ts`)
- Modify: `src/client/src/components/ChatView.ts` (`renderPart()` branch rendering the card + disclosure)
- Test: `src/client/src/chatMessages.test.ts` (projection), `src/client/src/components/ChatView.processNotification.test.ts` (happy-dom render)

**Approach:**
- Dispatch strictly on `customType`; details parser is field-by-field optional (log-match notifications lack exit code/duration), but a **minimum cardable shape** is required: a non-empty `summary` string. Anything less (including `{}`) → `undefined` → existing raw-text fallback, so an empty card can never render.
- Before pinning the schema, survey the installed extensions' emitted customTypes (acceptance criterion from the backlog item) to confirm only `ad-process:notification` gets this card; record findings in the test file's comments.
- Card layout: single-line summary + small status affordance derived from the notification kind/exit code; disclosure is a `<details>` with a `max-height`-bounded scrollable raw block; must hold up at 499px width.

**Patterns to follow:**
- `askUserRecordPart` / `parsedAskUserRecord` (strict parse, undefined fallback); `ChatView` part rendering and its per-concern test files.

**Test scenarios:**
- Happy path: lifecycle crash notification with full details → card shows summary, process name, failure affordance, exit code; raw XML not visible until disclosure opened.
- Happy path: success notification → success affordance, no error styling.
- Edge case: log-match notification (no exit code/duration) → card renders summary + name only, no empty placeholders.
- Edge case: `details` null/absent/non-object with known customType → raw-text fallback identical to today.
- Edge case: `details` is `{}` or has an empty `summary` → raw-text fallback (minimum cardable shape not met).
- Edge case: unknown customType with a `details.summary` present → raw-text fallback (dispatch is customType-only).
- Happy path: historical transcript containing pre-existing notifications renders cards on load (projection is pure; no live-event dependency).
- Integration (happy-dom): disclosure toggle reveals raw content; collapsed card height stays compact.

**Verification:**
- Related tests green; live korri session transcript (measured 37 notifications) renders compact cards; four-posture captures reviewed with the transcript containing at least one card.

---

### U6. Sessiond bridge: first-party extension + routes + events

**Goal:** Forgerie can read and control the selected session's pi-processes state: a bundled bridge extension joins each session's EventBus, HTTP routes serve snapshots/actions, and broadcasts stream as typed session events.

**Requirements:** R5, R7

**Dependencies:** U2 (for `COMMAND_WRITE`; list/logs/kill work against unpatched protocol too)

**Files:** (this repo)
- Create: `extensions/processes-bridge/` (the pi extension: joins EventBus, pins protocol constants from the fork's version, exposes an in-process registry keyed by session for sessiond to query)
- Create: `src/server/sessions/processBridgeService.ts` (+ colocated test) — snapshot/list/output/kill/write against the registry; explicit `{ available: false }` when the extension is absent in a session
- Modify: `src/server/sessions/sessionRoutes.ts` — routes under `/api/sessions/:sessionId/processes` (list, output, kill, write) so the existing wildcard proxy covers remote machines
- Modify: `src/shared/apiTypes.ts` — `SessionUiEvent` variants (`processes.update`, carrying authoritative snapshots rather than deltas) + wire types
- Modify: `src/server/sessions/piSessionService.ts` — publish bridge broadcasts through `SessionEventHub`; ensure extension (re)bind on `/reload` re-registers the bridge
- Test: `src/server/sessions/sessionRoutes.test.ts` (route additions), `src/server/sessions/processBridgeService.test.ts`

**Approach:**
- Bridge loading: inject the bridge as an inline first-party extension through the pi SDK's session resource loading (`resourceLoaderOptions.extensionFactories` or equivalent — confirm exact option name against the installed SDK). Installing the bridge as a profile package is the documented fallback only, not the primary path.
- **Injection gate (before any panel work):** prove the bridge loads and re-registers across all lifecycle paths — new session, `/reload`, daemon restart, and a remote-machine session — with a minimal logging bridge before building the service surface. U7 must not start until this gate passes.
- Event shaping: full snapshots (process list state) on lifecycle changes and on every (re)connect/reload — reconnect correctness comes free (client replaces state wholesale; no stale rows after daemon restart). Log output is **not** carried in snapshots: output updates are debounced (≥250ms per process) bounded tail deltas, and the panel fetches full recent logs on demand via the output route. This keeps chatty processes (pi-processes emits output events at ~100ms cadence) from flooding the socket.
- Actions gate: the list response carries a `writeSupported` capability flag (true only when the patched fork's `COMMAND_WRITE` channel is present) so the panel can hide stdin-write until U3/U4 have shipped.
- Pin protocol channel names/payloads as constants with a comment tying them to the fork's pinned version — drift fails loudly in one place.

**Test scenarios:**
- Happy path: list route returns the session's processes; output route returns bounded recent logs (cap ~200 lines server-side).
- Happy path: kill route → process terminates → snapshot event without the running row.
- Happy path: write route delivers stdin to a running process (patched fork present).
- Error path: kill/write on an exited or unknown process id → structured error, no daemon crash; panel-friendly error body.
- Error path: session without pi-processes → `{ available: false }` from list; actions rejected cleanly.
- Edge case: `/reload` → bridge re-registers; subsequent list works; a snapshot event follows rebind.
- Edge case: a process emitting output every ~100ms produces debounced bounded deltas, not per-event snapshots; socket message rate stays bounded.
- Edge case: unpatched pi-processes (no `COMMAND_WRITE`) → list reports `writeSupported: false`; write route rejects cleanly.
- Integration: broadcast from a real EventBus emission reaches `SessionEventHub.publish` as a `processes.update` with the full snapshot.

**Verification:**
- Route + service tests green; manual: start a process in a live session, observe snapshot events on the session WebSocket and correct route responses, including through the remote-machine proxy path.

---

### U7. Processes panel plugin

**Goal:** A workspace panel showing the selected session's managed processes with live updates, logs, stop, and stdin-write. (Absorbed backlog item `01KZFJFV…`.)

**Requirements:** R5, R6, R7

**Dependencies:** U6

**Files:** (this repo)
- Create: `pi-web-plugins/processes/pi-web-plugin.ts` (manifest, `workspacePanels` contribution with running-count badge), `pi-web-plugins/processes/processesPanelElement.ts`, `pi-web-plugins/processes/processesClient.ts` (+ tests beside each)
- Modify: `src/client/src/plugins/types.ts` + `src/plugin-api/unstable.ts` + `plugin-api/unstable.d.ts` — expose a `processes` capability on `piWebUnstable` (selected-session identity, snapshot fetch, action calls, subscribe-to-updates) so the plugin never touches `/api/` directly (enforced by `pluginPublicApi.test.ts`)
- Modify: plugin registration/bundling where bundled plugins are declared (mirror workspace-tasks)

**Approach:**
- Panel state comes from the unstable capability: initial snapshot on open and on every (re)connect/reload signal; `processes.update` events replace list state wholesale; log tails accumulate from bounded deltas with full-log fetch on demand.
- Stdin-write UI renders only when the capability reports `writeSupported` (kept hidden against an unpatched extension).
- Distinct rendered states: no session selected; extension unavailable; empty; populated. Session identity shown in the header.
- Mobile-first card: name + status chip + uptime on one line; logs and stdin-write inside a collapsible section; stop as a compact affordance with confirm; log block `max-height` + scroll. Intrinsic layout only — no viewport breakpoints (AGENTS.md 499–979px rule).
- Kill race handling: after stop is pressed, terminal-state snapshot wins; late errors for already-exited processes are suppressed.

**Patterns to follow:**
- `pi-web-plugins/workspace-tasks/` end-to-end (manifest, element, client module, tests, public-API discipline).

**Test scenarios:**
- Happy path: populated snapshot renders rows with name/status/pid/uptime; `processes.update` replaces rows live.
- Happy path: stop action calls the capability and reflects the terminal snapshot.
- Happy path: stdin write sends input, clears the field on success, surfaces structured errors inline.
- Edge case: empty list vs. `{ available: false }` vs. no-session — three distinct states with distinct copy.
- Edge case: reconnect signal triggers a fresh snapshot fetch (stale rows replaced; daemon-restart case renders empty, not stale "running").
- Error path: write to exited process → inline error, panel remains interactive.
- Edge case: kill race — snapshot marks process exited before kill reply arrives → no error shown.
- Integration (happy-dom): badge reflects running-count; disclosure interactions work.

**Verification:**
- Plugin tests + `pluginPublicApi.test.ts` green; live: full lifecycle (start via chat → appears in panel → logs stream → stop from panel) on desktop and all four Fold 8 postures, captures read and judged.

---

### U8. Ship, deploy, and close the loop

**Goal:** Everything verified, deployed on zao, documented, and backlog items closed.

**Requirements:** R1–R7

**Dependencies:** U4, U5, U7

**Files:** (this repo)
- Modify: `AGENTS.md` (brief: processes are first-class — panel, renderer, patched-fork dependency note and where it lives), changeset files per the changeset-changelog skill
- Modify: `work/items/active/01KZFNG5XM0Y6CN7B39KFZFCE5-first-class-pi-processes/` (status), remove absorbed parking-lot files

**Approach:**
- `npm run verify` green; build; restart `forgerie-sessiond`/`forgerie-web`; tailnet + local 200 checks; final posture matrix on the shipped build.
- Close backlog items `01KZF4JF…` and `01KZFJFV…` via the backlog tooling; archive the work item.

**Test scenarios:**
- Test expectation: none — release/operational unit; validation is the deployed checks above.

**Verification:**
- Deployed instance serves the panel and cards; all services active; work item archived with terminal status.

---

## System-Wide Impact

- **Interaction graph:** new `SessionUiEvent` variants flow through `SessionEventHub`, the session WebSocket, `SessionController`, and the plugin capability — additive; existing event consumers ignore unknown types by design (verify `parseSessionSocketEvent` tolerates new variants for older clients).
- **Error propagation:** bridge/route errors must return structured bodies, never crash sessiond; spawn-resolution errors in the fork become loud tool errors visible in transcripts (better than silent wrong-shell spawns).
- **State lifecycle risks:** snapshot-not-delta events eliminate stale-row reconciliation; daemon restart and `/reload` paths are explicit requirements (R7). The patched fork changes spawn env for the TUI too — same fix applies, but validate TUI behavior in U4.
- **API surface parity:** the plugin API gains an unstable `processes` capability; `plugin-api/unstable.d.ts` and `src/plugin-api/unstable.ts` must stay in sync (knip/typecheck enforce).
- **Integration coverage:** EventBus → hub → socket → panel is covered by U6/U7 integration scenarios; the fork's spawn behavior is covered by U2 regression tests plus the U4 live matrix.
- **Unchanged invariants:** transcript rendering for every other message type; `ASK_USER_ANSWERS_CUSTOM_TYPE` handling stays first; existing plugins and `PI_WEB_*`/route compatibility contracts untouched; upstream pi-processes protocol semantics unchanged (additive `COMMAND_WRITE` only).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| U1 finds a root cause outside pi-processes (e.g., in pi's extension loading) | Patch whatever layer is truly at fault; the fork+Nix mechanism generalizes (pi itself is already consumed via `pi.nix` in mountainous) |
| `buildNpmPackage` friction with the fork's pnpm lockfile / peer deps | Fallback: source-only derivation if pi resolves plugin deps from the profile; worst case, commit a generated npm lockfile to the fork |
| Upstream pi-processes updates drift from the fork | `PATCHES.md` + pinned rev + small per-concern commits; updates are deliberate rebases, never automatic |
| Bridge injection mechanism unavailable in pi SDK | Fallback documented: install bridge as a profile path package — same code, different registration |
| Restarting sessiond for U4 kills active agent runs | Schedule the restart; it is a one-time cutover per deploy, already the standing deploy rule |
| Panel density fails folded-portrait acceptance | Mobile-first card design with collapsible sections is specified up front; posture captures are per-unit verification, not an afterthought |

---

## Documentation / Operational Notes

- `AGENTS.local.md`: record the patched-fork install path, the retired wrapper, and the interception flag — the machine-local operational truth.
- Mountainous package README documents the `settings.json` one-time switch and the update/rebase procedure for the fork.
- Rollback: revert `settings.json` to `npm:@aliou/pi-processes` and disable interception — the product features degrade gracefully (panel shows unavailable; cards still render).

---

## Sources & References

- Work item: `work/items/active/01KZFNG5XM0Y6CN7B39KFZFCE5-first-class-pi-processes/work.md`
- Absorbed backlog items: `work/items/parking-lot/01KZF4JF5TPQA7C6F4ZXC84ESZ-….md`, `work/items/parking-lot/01KZFJFV6XSPHZHFWG8A39B9P7-….md`
- Related code: `src/client/src/chatMessages.ts`, `pi-web-plugins/workspace-tasks/`, `src/server/sessions/piSessionService.ts`, `src/shared/apiTypes.ts`
- pi-processes source (read at `~/.pi/agent/npm/node_modules/@aliou/pi-processes`, v0.10.4): `src/utils/command-executor.ts`, `src/protocol/`, `extensions/processes/`
- Live validation evidence: this session's probe results (wrapper honored 1/5 spawns; exit-127 via login-shell PATH rewrite)
