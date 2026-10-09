# Bun and packaging spikes

Bun 1.4.2 does not pass the unchanged-runtime gate. Keep production on Node 24.

This is a gated experiment, not a runtime migration. Source baseline: `81501269`. The experiment changes no production source, dependency versions, lockfile, framework or deployed service.

## Five-spike status

| Spike | Result | Evidence or remaining work |
| --- | --- | --- |
| 1. Uncompiled Bun compatibility | Failed | The production HTTP idle-timeout configuration does not terminate a stalled response under Bun. |
| 2. Pi lifecycle and extensions | Partial | Existing real SDK/Durable acceptance tests and daemon smoke cover extensions, configured providers, codemode/WASM, children, cancellation, persistence, TCP/Unix sockets and reconnect. This is not the complete lifecycle qualification or a live-provider test. |
| 3. Compiled executable | Blocked by 1 | No compiled daemon was built. Resource/worker packaging remains untested. |
| 4. Nix distribution | Blocked by 1 and 3 | No Forgerie derivation was built. Offline construction, fixup, closure/download size and other platforms remain untested. |
| 5. Active-node performance and soak | Blocked by 1 | No performance or soak comparison. Compatibility-run timings are not benchmark results. |

## Comparison

The same npm lock and Vitest 4.1.10 ran with two workers. The additional test setup recorded each worker's runtime. All Bun workers reported Bun 1.4.2. Its Node compatibility version is 26.3.0; that is not a separate Node process.

| Measure | Node 24.13.0 | Bun 1.4.2 |
| --- | ---: | ---: |
| Test files passed | 193 | 176 |
| Test files failed | 0 | 17 |
| Tests collected | 1773 | 1678 |
| Tests passed | 1770 | 1669 |
| Tests failed | 0 | 6 |
| Tests skipped | 3 | 3 |
| TCP daemon smoke | Passed | Passed |
| Unix-socket daemon smoke | Passed | Passed |
| Production HTTP idle-timeout probe | Passed, three runs | Failed, three runs |

Bun's 15 suite import errors prevented test collection. Do not describe its result as only six failures among the full Node test count.

The daemon smoke runs compiled JavaScript with the ordinary runtime, outside the checkout. It tests HTTP validation, a WebSocket creation event and reconnect, session creation, an external extension command, a real shell subprocess, session discovery after daemon restart and SIGTERM shutdown. It uses an isolated profile with no provider credentials. It does not run a live LLM or a compiled Bun executable.

## Confirmed runtime failure

`http-idle-probe.mjs` imports the production `configureAgentHttpDispatcher()` from built output. A loopback HTTP server writes one chunk, waits 1500 ms, then writes the rest. The probe configures a 300 ms idle timeout and uses native global `fetch`.

Node rejects the body with `UND_ERR_BODY_TIMEOUT`. Its timer fires at about one second, not precisely 300 ms. Bun returns the complete body after the gap. All three comparisons produce the same verdict outside Vitest.

Bun resolves bare `undici` to `undici`, rather than the installed npm file. The resulting `Agent` and configured dispatcher lack `close()`. Importing the installed `node_modules/undici/index.js` directly exposes `close()` under both runtimes. That confirms module substitution. It does not prove that importing the npm module alone fixes native Bun fetch.

The configured timeout is runtime behavior, not a test wording preference. A silent loss of this setting blocks an unchanged production migration. A Bun-specific fetch/dispatcher adapter requires its own compatibility investigation and tests.

## Other failures and limits

Fifteen Bun/Vitest suites fail with undefined Zod named imports. A direct import parses the same schema under both runtimes. An isolated run of `appPlugins.test.ts` reproduces the failure, so it does not require contamination from the full suite. Treat this as a test-tool integration failure, not a proven daemon import failure. The bounded failure list is in `evidence/bun-full-corrected/files.json`.

One diagnostic-client test rejects Bun's timeout message, `The operation timed out.`, because it expects `/abort|timeout/i`. The request does time out. This is an assertion portability issue, distinct from the HTTP body-timeout failure.

The first full runs omitted `npm_execpath`. That was an experiment-runner error affecting both runtimes. The corrected complete runs above supply it. Early daemon smoke failures also came from the experiment script: a JavaScript-incompatible shebang, assuming the first event was session creation, and omitting the shell API's `!` prefix. They do not count as runtime failures.

The host's existing Bun is 1.3.11 and its registry Bun is 1.3.10. The experiment fetched the exact upstream 1.4.2 baseline Linux binary, checked its release archive SHA-256 and patched only that private copy's loader for Nix. `evidence/runtime.json` records the inputs and resulting version. This is not a completed Nix packaging spike.

No active-node CPU, settled memory, event-loop, throughput or cleanup-soak measurements exist. Shared-host concurrent test/smoke durations cannot support a speed claim. There is no evidence yet that Bun gives Forgerie a useful performance gain.

## Repository verification

`npm run verify` passes on the recorded Node baseline. It includes typecheck, lint, both Knip checks, 1770 server/shared tests and 1288 browser tests. Four tests are skipped across the two suites. No UI or production code changes belong to this experiment. No deployment or service restart is required.

## Reproduce

Use an isolated worktree at the recorded source commit. Install the unchanged lock without prepare hooks:

```sh
nix shell nixpkgs#nodejs_24 -c npm ci --ignore-scripts --no-audit --no-fund
nix shell nixpkgs#python3 nixpkgs#patchelf -c python3 prototypes/bun-packaging/fetch-runtime.py
nix shell nixpkgs#nodejs_24 -c node node_modules/typescript/bin/tsc -p tsconfig.build.json
```

Run each test command separately. The runner strips ambient credentials and uses temporary HOME, profile, configuration and data directories:

```sh
nix shell nixpkgs#python3 nixpkgs#nodejs_24 -c python3 prototypes/bun-packaging/run-tests.py --runtime node --label node-full-corrected
nix shell nixpkgs#python3 nixpkgs#nodejs_24 -c python3 prototypes/bun-packaging/run-tests.py --runtime bun --label bun-full-corrected
nix shell nixpkgs#python3 nixpkgs#nodejs_24 -c python3 prototypes/bun-packaging/run-api-probes.py resolution
nix shell nixpkgs#nodejs_24 -c node prototypes/bun-packaging/daemon-smoke.mjs node node-daemon
nix shell nixpkgs#nodejs_24 -c node prototypes/bun-packaging/daemon-smoke.mjs bun bun-daemon
```

Raw runs stay under `/tmp/forgerie-bun-spikes`. `save-evidence.py` preserves bounded summaries and compressed original test logs in `evidence/`; it never copies profile databases or credentials. Early runner failures remain only in the temporary run directory.

## Next decision

A bounded Bun-specific HTTP adapter experiment can establish whether this blocker has a small fix. Its cost is maintaining another fetch/configuration path and qualifying provider, proxy, compression, abort and stream behavior. It does not establish a performance benefit.

After that experiment, rerun gate 1 and complete gate 2 before compiling. Keep the package manager, lock and framework fixed. If compatibility work grows or performance gains do not justify it, keep Node.

Workspace-service lifecycle and two-node recovery remain separate pool experiments. Neither is solved by selecting Bun or compiling an executable.
