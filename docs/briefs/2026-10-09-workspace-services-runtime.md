# Workspace services API and runtime

## Decisions

The user chose to keep workspace services running across Forgerie restarts. Services belong to a worktree, not a Pi turn or connection. A host or container shutdown can stop them. Pi is the only supported agent. No MCP adapter is planned.

Process Compose owns dependencies, probes and process restart policy. Forgerie owns instance identity, named ports, retained data, lifecycle admission and recovery. Native Pi tools and browser API clients use the same manager.

## First local delivery

Implement explicit start, status, bounded logs, service controls, readiness waits and confirmed shutdown for managed worktrees. Use the existing project file and preserve version 1 behavior. Add a version 2 services declaration and an argv environment prefix. Services start only after explicit approval to execute repository code. Default to manual start. Preserve existing main-checkout hooks without changing their source or environment implicitly.

Use pinned Process Compose 1.120.0 from the repository's existing nixpkgs revision. Provision once through Nix and keep a GC root while instances need it. Do not adopt arbitrary binaries from repository PATH.

On systemd hosts, a separate transient user service owns each instance. Outside systemd, a detached Unix session owns it, including the separate process groups that Process Compose creates for workers. Refuse launches from a systemd unit if its user supervisor is unavailable. The independent instance must not share sessiond's unit cgroup.

Persist launch intent before launch. A random API token authenticates the recorded socket. Missing sockets do not prove exit. A recorded supervisor or process birth identity must prove exit before replacement. Unknown ownership blocks duplicate starts and cleanup. A manager lock prevents two daemons from mutating the same inventory.

Store state outside the checkout. Stop confirmed instances before a pre-remove hook. Retain service data after Land or Discard. Port allocation coordinates Forgerie instances but cannot reserve ports against other programs. Report a bind failure rather than repeatedly restarting unrelated processes.

## Acceptance

Exercise a real Unix-socket Process Compose instance, two independent worktrees, readiness, bounded logs, failure/restart, reattachment after manager disposal, and confirmed shutdown. Exercise a real transient systemd user service and prove that stopping its launching unit does not stop it. Test unavailable sockets and interrupted launch records without substituting stopped status.

## Verification

Verified on Linux with Node 24 after rebasing onto `74800a29`:

| Check | Result |
| --- | --- |
| `npm run verify` with Process Compose acceptance enabled | Passed. Server: 1851 passed, 3 skipped. Browser tests: 1352 passed, 1 skipped. Static checks and UI gates passed. |
| `npm run test:coverage` with the same runtime | Passed with unchanged thresholds. Statements 88.00%, branches 78.28%, functions 91.33%, lines 93.13%. |
| `npm run build` | Passed. |
| `scripts/verify-workspace-services-restart.mjs` against compiled modules | Passed. Separate cgroups, launching unit stopped, service reachable, port 36851 preserved, retained data recovered, and confirmed service shutdown. |
| Compiled detached-launch acceptance | Passed. Graceful shutdown proves exit. Killing the supervisor group while a worker survives reports unknown ownership. Killing the surviving worker permits exit confirmation. |
| `npm pack --dry-run` | Required compiled modules and service documentation present. Test helpers excluded. This was not an installed-package test. |

Process Compose starts workers in separate process groups. The first detached ownership check incorrectly reported exit after its supervisor group died. A real-runtime regression test reproduced this. The launcher now records and inspects the whole Unix session, including worker groups. Detached commands that create another session remain outside this boundary.

The compiled runner executes under a private test environment. The native tool tests use real Durable/SDK wiring and a temporary profile. No deployed Forgerie units were restarted. Non-Linux Unix hosts were not exercised. Browser controls and physical-device acceptance were not part of these checks.

## Follow-up boundaries

Browser controls, preview proxying, automatic service startup, changed setup/carry behavior and Pi shell environment integration require later slices. This delivery does not claim complete UI acceptance. Existing hooks remain unchanged. Federation, resource-based placement, Nostr, session migration and machine failover remain outside this delivery. Do not restore retired remote proxies.
