# Bounded Bun HTTP adapter experiment

The adapter does not pass. Keep production on Node 24. Do not unblock compilation, Nix packaging or performance testing with these results.

The user approved a throwaway HTTP workaround investigation after the unchanged-runtime gate failed. This follow-up uses source baseline `886b49b6`, Node 24.13.0, Bun 1.4.2 and installed npm undici 8.10.2. Its npm lock SHA-256 matches the original `81501269` experiment. No production source, package versions, lockfiles, service units or live profiles changed.

## Results

The same loopback fixtures exercise 31 checks. Each action has a 6000 ms deadline. Timings are compatibility observations under shared-host load, not performance measurements.

| Runtime and configuration | Passed | Failed | Result |
| --- | ---: | ---: | --- |
| Node, production dispatcher and native fetch | 31 | 0 | Passes. |
| Bun, unchanged production module and native fetch | 23 | 8 | Configured idle timeouts and proxy routing fail. |
| Bun, installed npm dispatcher and native fetch | 23 | 8 | Forcing the dispatcher alone does not fix either behavior. |
| Bun, installed npm dispatcher and npm fetch | 24 | 7 | Pending body errors hang. HTTP object types also disagree. |
| Bun, installed npm dispatcher and full `undici.install()` | 26 | 5 | HTTP object types agree, but pending body errors still hang. |

Full installation passes header timeout, disabled timeouts, progressive streams, aborts before headers, reader cancellation, gzip/deflate/Brotli JSON, progressive gzip SSE, Request/FormData uploads and streaming uploads. It also passes locally trusted TLS, proxy authentication/routing, lowercase environment precedence, `NO_PROXY`, compressed JSON through a TLS proxy and cleanup.

These five full-install checks do not settle within 6000 ms:

- The body read does not reject after the configured idle timeout.
- The reader does not reject after aborting a started body.
- The body read does not reject after a mid-stream socket failure.
- The body read does not reject after an idle timeout through a TLS proxy.
- The reader does not reject after aborting a started body through a TLS proxy.

Replacing fetch alone also produces a Response that is not an instance of the global Response. Passing the global Request to npm fetch fails with `Failed to parse URL from [object Request]`. Full installation repairs these type mismatches, not the body-error hangs.

## Minimized failure

`http-error-probe.mjs` needs neither Forgerie nor Vitest. It calls installed npm undici's fetch with its default Agent. Bun's pending body read does not settle after either a body timeout or an abort. Both cases fail in two runs with 3000 ms deadlines. Node rejects both correctly in both runs.

Standalone ReadableStream error propagation passes for ordinary and byte streams on both runtimes. The failure therefore reproduces in the Bun/npm-undici combination without Forgerie's custom client factory or fetch installation. The exact internal cause remains unknown.

## Compatibility and daemon smoke

The Bun compatibility rerun forces the installed undici import through a prototype-only Vitest alias and calls `install()` in each worker. Vitest and all tests remain unchanged. All 195 per-file worker observations report Bun 1.4.2 and the installed fetch. This is an adapted-runtime run, not a pass for unchanged Bun.

| Bun compatibility result | Count |
| --- | ---: |
| Test files passed | 178 |
| Test files failed | 17 |
| Test files blocked by imports | 15 |
| Tests collected | 1711 |
| Tests passed | 1706 |
| Tests failed | 2 |
| Tests skipped | 3 |

The import failures still concern undefined Zod imports under Bun/Vitest. The two collected failures are the HTTP idle-body test and the existing timeout-message assertion. No assertions were weakened or removed.

The first Node and Bun suite runs also failed a resource-inventory assertion. The runner caused that failure by forcing `PI_OFFLINE=1`. The SDK skips the missing-package callback in that mode, including a callback that returns `skip` without installing anything. The qualified runs use empty isolated profiles and exclude ambient credentials, but leave that SDK setting at its normal default. The resource-inventory assertion then passes under Bun. `--sdk-offline` reproduces the earlier harness error.

The adapted private daemon passes TCP and Unix-socket smoke: HTTP validation, WebSocket creation/reconnect, session creation, an external extension command, a shell subprocess, restart discovery and SIGTERM cleanup. That smoke does not test failing model streams and cannot overrule the HTTP failures.

Unmodified `npm run verify` passes under Node 24.13.0 at source baseline `886b49b6`: typecheck, lint, both Knip checks, 1803 server/shared tests and 1316 browser tests. Four tests are skipped. This verification does not cover later unrelated commits on `main`.

## Cost and limits

Using the installed npm module requires bypassing Bun's bare `undici` substitution. `undici.install()` changes fetch, HTTP constructors, WebSocket and event constructors for every in-process consumer. A fetch-only swap is not enough. Both paths require separate provider and lifecycle qualification.

Further work would require diagnosing the body-error interaction or implementing another transport. Neither is a small demonstrated adapter fix. Keeping Node leaves compiled distribution and any possible Bun performance benefit untested.

All network fixtures use loopback. Proxy credentials and the trusted CA are synthetic. The proxy refuses other destinations. Proxy environment variables change before each dispatcher is created; these results do not establish Bun's behavior for every proxy setting supplied at process startup. Live providers, captured fetch references, provider-specific transports, rejection of untrusted TLS certificates, HTTP/2, redirects, long soaks, other platforms and compiled executables remain unqualified.

The initial proxy fixture incorrectly required CONNECT for plain HTTP. Node uses forwarding for plain HTTP. The corrected fixture supports forwarding and CONNECT. Only the corrected matrix supports the table above. An early unbounded probe stopped at its 75-second process deadline; the corrected probe bounds each action and records failures.

## Reproduce

Start from the recorded source baseline in an isolated worktree. Copy these prototype files there if that baseline predates the evidence commit. Use the unchanged lock and the verified Bun binary described in [README.md](README.md).

```sh
nix shell nixpkgs#nodejs_24 -c npm ci --ignore-scripts --no-audit --no-fund
nix shell nixpkgs#nodejs_24 -c node node_modules/typescript/bin/tsc -p tsconfig.build.json
./prototypes/bun-packaging/run-http-adapter.py matrix --label http-adapter-rerun
./prototypes/bun-packaging/run-http-adapter.py errors --label http-adapter-rerun
./prototypes/bun-packaging/run-http-adapter.py compat --label http-adapter-rerun --runtime bun
./prototypes/bun-packaging/run-http-adapter.py smoke --label http-adapter-rerun
```

The runner refuses the main checkout and accepts only safe directory labels. Run commands separately. Matrix and Bun compatibility commands are expected to exit 1. The error runner records the expected Bun failure but does not itself exit 1. No command changes tracked production source. Matrix creates an additional private compiled dispatcher module. Smoke temporarily patches the private compiled dispatcher, then restores it in `finally`; do not run smoke concurrently with matrix or interrupt it with SIGKILL. Rebuild private output before retrying after a hard interruption.

For repository verification, install the separate UI lock, then run the unmodified Node check:

```sh
nix shell nixpkgs#nodejs_24 -c npm --prefix ui ci --ignore-scripts --no-audit --no-fund
./prototypes/bun-packaging/run-http-adapter.py verify --label http-adapter-rerun
./prototypes/bun-packaging/run-http-adapter.py save --label http-adapter-rerun
```

The matrix, minimized failures and daemon smoke live in `evidence/http-adapter-corrected/`. The corrected suite qualification lives in `evidence/http-adapter-qualified/`; the independent error repeat lives in `evidence/http-adapter-repeat/`. The earlier `bun-compat` report under `http-adapter-corrected` used forced SDK offline mode and is historical, not the table's qualification. Reports include exact commands, runtime-worker evidence, file-level failures, compressed logs, source and lock fingerprints. They exclude profile state, TLS private keys and live credentials. No deployment or service restart belongs to this prototype.
