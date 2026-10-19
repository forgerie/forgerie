# Testing and coverage

Forgerie uses Vitest for contracts, services, routes, components, and integration tests. Run development and verification on Node 24.

## Commands

| Command | Scope |
| --- | --- |
| `npm test` | Complete server and shared-code suite. |
| `npm run test:watch` | Server tests on saved changes. |
| `npm run test:related -- src/path/to/module.ts` | Tests related through imports. |
| `npm run test:changed` | Current branch and worktree changes since the merge base with `main`. |
| `npm run test:coverage` | Server suite with coverage thresholds and four workers. |
| `npm run verify:static` | Server typecheck, ESLint, server Knip, and browser-app Knip. |
| `npm run verify:ui` | Browser build, lint, tests, and decomposition gates. |
| `npm run verify` | Both applications' static and test verification. |
| `npm run build` | Clean compiled server output and browser build. |
| `npm run smoke:package-install` | Isolated installed-package managed-process and subagent smoke tests. |

GitHub CI runs on Linux. It uses `npm run test:coverage -- --no-file-parallelism` to prevent compiler-graph and SDK acceptance tests from competing for CPU. Every test, deadline, isolation boundary, and coverage threshold stays enabled. The cost is a longer coverage run. Local `npm run test:coverage` still permits four workers.

The package-install smoke test also passes the real tarball's manifest to npm's own platform validator with `os: "win32"`. npm's CLI `--os` override only affects optional dependencies. This verifies the package restriction, not execution on Windows. Native Windows server support is retired. Browser access from Windows is unchanged.

Use focused tests while editing. Run `npm run verify` before merging cross-cutting changes. A child agent runs focused checks and leaves `npm run verify` to its parent, unless its task assigns the run; a workflow runs it once per stage. Each commit's pre-commit hook already runs the cached typecheck, Knip, ESLint on staged files and the related tests. Build and install only in an isolated worktree when active agents use the deployed checkout. Do not restart live services to run tests.

## Serial lane

`vitest.config.ts` runs the suite as two projects. The `parallel` lane runs first. The `serial` lane then runs the files in `scripts/test-serial-lane.mjs` one at a time. These files timed out when they shared the CPU with the rest of the suite, and passed when they ran alone. The lane applies to `npm test`, the coverage run and the pre-commit hook's related tests. Coverage and assertions are unchanged.

The lane includes `durableChildAutonomy.test.ts` and `durableRiskLabels.test.ts` under `src/server/sessions/`. Before their addition on 2026-10-17, isolated runs passed all 27 and 15 tests, respectively. `src/server/triggers/triggerTool.test.ts` joined on 2026-10-19: its `workflow_schedule` tests took 3.2 s alone against a 5 s limit, and timed out in three of four parallel runs once another test file changed the schedule. The complete file list lives in [`scripts/test-serial-lane.mjs`](../scripts/test-serial-lane.mjs); configuration regression tests check actual Vitest discovery, lane ordering, and test-file isolation.

The cost is wall time: the serial files run after the others and do not overlap with them. Remove a file from the list once it passes reliably in the parallel lane. Do not add a file to hide a real failure: rerun it alone first, and add it only when the alone run passes. Passing alone supports resource contention as a cause; it does not prove contention is the only cause or rule out a race.

## Managed process core acceptance

The core API and its limits are in [managed-processes-core.md](managed-processes-core.md).
On Linux with a systemd user manager, Node 24, Python 3, and util-linux:

```sh
npm test -- src/server/processes
npx tsc -p tsconfig.build.json
node scripts/verify-managed-processes-restart.mjs
```

The proof uses temporary units, not deployed Forgerie units. It checks restart
survival, stdin/EOF, exit results, slice stop, output interleaving, and attached
parent-death cleanup. It cleans its units even on failure and retains failed
proof files for inspection.

## Workspace services acceptance

The normal suite uses a real Unix-socket contract server. Enable the external-runtime tests to check Process Compose itself:

```bash
nix build github:NixOS/nixpkgs/e72e4f299401a3689d4b3d5fc6496b11db7064eb#process-compose \
  --out-link /tmp/forgerie-test-process-compose
FORGERIE_TEST_PROCESS_COMPOSE=/tmp/forgerie-test-process-compose/bin/process-compose \
  nix shell nixpkgs#nodejs_24 -c npm run test:coverage
```

On a Linux host with a systemd user manager, build first, then check restart survival with the compiled modules:

```bash
nix shell nixpkgs#nodejs_24 -c npm run build
nix shell nixpkgs#nodejs_24 -c node scripts/verify-workspace-services-restart.mjs
```

The script creates a temporary repository, profile, and launching unit with `KillMode=control-group`. It proves that the service has a separate cgroup and survives stopping that unit. A new manager must recover the same ports and retained data. The script then stops its service. It makes no model requests and does not restart deployed Forgerie units. A failure can retain the temporary directory and service for inspection. Read `owner.log` there, not the private `launch.json`.

These checks prove API and runtime behavior. They do not prove browser controls or physical-device acceptance.

## Browser verification

The browser suite uses happy-dom for DOM behavior. It does not prove layout, clipping, scroll geometry, or real device behavior.

### Worker budget

`ui/vite.config.ts` defaults to two workers. This bounds the number of compiler and DOM runtime graphs competing for resources. Test-file isolation, setup, assertions, deadlines, and gates stay enabled; there are no added retries. Fewer workers can make healthy runs slower. The budget cannot limit CPU use from other sessions or fix a product race.

Override the budget explicitly when measuring another host or isolating a failure:

```sh
npm --prefix ui test -- --maxWorkers=4
npm --prefix ui test -- src/ForgerieSession.drafts.test.tsx --maxWorkers=1
```

On 2026-10-17, a bounded comparison on Nix Node 24.13.0 used the three previously timeout-sensitive files (`ForgerieSession.drafts.test.tsx`, `triggers/TriggerFile.binding.test.tsx`, and `ui/markdownDocument.corpus.test.ts`) plus `ForgerieSession.decisions.test.tsx`, all under `ui/src/`. Runs used the same source and command, changing only `--maxWorkers`, in order 4, 2, 2, 4. No other checks from this worker overlapped the timed runs.

| Run | Workers | Result | Command wall time | Host starting load average (1 minute) |
| --- | --- | --- | --- | --- |
| 1 | 4 | 495/495 passed, 4 files | 140.89 s | 5.28 |
| 2 | 2 | 495/495 passed, 4 files | 92.88 s | 9.41 |
| 3 | 2 | 495/495 passed, 4 files | 109.08 s | 6.60 |
| 4 | 4 | 495/495 passed, 4 files | 171.88 s | 7.33 |

Two workers passed and were faster in this sample, which supports a conservative two-worker default. This is not a full-suite benchmark or proof that two workers are optimal. The shared host load varied, caches were not reset, and most test time was in the markdown corpus. Neither budget reproduced the historical timeouts. Contention is not proven to be the sole cause. Recheck with a representative full browser suite before increasing the default; keep command-line overrides available.

### Browser acceptance

Use the UI's production components and fixture APIs for previews. Do not intercept network requests or replace a production renderer with a copied mockup. `ui/gates/` checks component ownership, parts, tokens, and decomposition. Remove a pending entry when its offence disappears; never add an entry to hide a new offence.

For posture captures, start an isolated browser-app dev server. Use the repository's CDP posture runner, not Chromium window sizing:

```bash
node scripts/capture-postures.mjs --url http://127.0.0.1:8505/ \
  --out /tmp/forgerie-shots --label change --color-scheme dark
```

Repeat in light mode and read every PNG. The four Fold 8 CSS viewports are `704 × 783`, `932 × 553`, `475 × 638`, and `711 × 374`. Captures prove emulated geometry, not physical-device acceptance. Use Caliper parts and their checks when the changed component has a part. Record missing parts and remaining findings rather than claiming a pass.

## Affected tests

`scripts/test-selection.mjs` adds tests for speech-worker files read at runtime. Package manifests, TypeScript or Vitest configuration, bundled dependencies, and deleted source files trigger the full suite. Deletion removes import-graph evidence, so related tests alone are not sufficient.

`test:changed` selects committed, staged, unstaged, and untracked paths, then tests current worktree content. The pre-commit hook uses the same policy for staged source. A dirty worktree uses a temporary Git-index snapshot with the installed server dependencies. The complete verification remains the merge gate, including the separate browser app.

## Coverage and isolation

Server coverage measures product code under `src/`. It excludes test support, declarations, engineering scripts, process entrypoints, and the CLI-only version report. Browser coverage and tests belong to `ui/`, not the server's Knip or Vitest graph.

Coverage writes HTML, LCOV, and JSON under `coverage/`. Thresholds are a ratchet; do not lower them to make cleanup pass. Prefer tests of externally visible behavior, validation, durable state, lifecycle ordering, and failure handling.

Keep test-file isolation. Tests change environment variables, globals, filesystem state, and process state. Real temporary repositories, in-process servers, and controlled subprocesses verify these contracts without touching live profiles or service units.

## Durable session supervisor acceptance

On Node 24, build the server with `npx tsc -p tsconfig.build.json`, then run
`npm run verify:durable-restart`. Without Linux user-systemd, both modes
print `UNVERIFIED` and exit 2, not a pass. It uses a uniquely named temporary unit with
`KillMode=control-group`, a temporary profile/data directory, and the faux
provider. It restarts while safe and unsafe tools are in flight, then uses
startup recovery without another input. It checks that the safe call uses the
new owner and the unsafe call reports interruption without running twice.
It stops and cleans the proof unit in all cases, and retains shutdown and
recovery logs on failure. It never contacts deployed Forgerie services.
This small proof exercises the journal and startup recovery seam, not the HTTP daemon.

Run `npm run verify:durable-restart -- --daemon` for production-daemon acceptance.
It starts the compiled `dist/server/sessiond.js` entry point, not a replacement
signal handler. Each case uses a unique temporary user-systemd unit, an empty
profile/data directory, a faux provider loaded through a profile extension, and
an attached native browser WebSocket. It restarts with a tool in flight. The
graceful case must stop within `TimeoutStopSec=10s` without timeout or shutdown
errors. The forced case sends SIGKILL to the proof unit. Both require startup
recovery before any new prompt or browser attachment, interruption without
repeating the unsafe call, and successful extension, read, and bash tools under
the new owner. All proof units are stopped; failed profiles and daemon/supervisor
logs are retained. No live units, profiles, credentials, or provider APIs are used.
This is a socket-level browser attachment, not browser UI acceptance.

Current-repo result (2026-10-18): graceful restart passed. Immediate startup after
SIGKILL failed with `ELOCKED` on the temporary `data/workspace-services` directory.
The acceptance command remains standalone and is **not connected to deployment
preflight** while that real ownership defect is present. The staged launcher in
`scripts/redeploy-when-idle.sh` delegates publication checks to `src/deployment.ts`;
wire acceptance there only after the defect is fixed and both cases pass. Do not
wait for the lock to age out or delete it in the check: that would hide the failure.

## Worktree dependency preflight

Run `npm ci` from the worktree root before verification. Root `prepare` installs
`ui/` with its own lockfile. The repository's post-create hook does this for
Forgerie-created worktrees. This repository's `.githooks/post-checkout` also runs
it on the first checkout of a manual linked worktree when Git hooks are enabled.
The shared post-create hook records success in the private Git directory to avoid
a second install. `--no-checkout` creation and disabled hooks still need `npm ci`
explicitly. Run `npm test -- scripts/worktree-post-checkout.test.mjs` to exercise
real manual/managed Git creation, setup failure/retry, and ordinary checkouts
with a controlled npm executable (no dependency downloads).
`node scripts/verify-staged.mjs --check-dependencies` checks the whole current
root and browser dependency environments without running staged validation.
Staged validation runs this check before the cached typecheck. It accepts working
links and reports incomplete installs as one environment error, not Knip findings.
