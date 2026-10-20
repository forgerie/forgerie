# Controlled stack latency measurements

Use Node 24 and managed processes. Never use a live profile, provider credential,
production service, or remote endpoint for these commands. Fixtures bind
loopback only, on the assigned ports 18641–18656. Fixture logs are private:
they can contain deterministic transcript data.

## Native fixture

```sh
node --import tsx scripts/stack-latency-native.mjs \
  /tmp/fg-native-UNIQUE 18642 /absolute/path/to/dist/client [--measure] [--seed-limit-sec=180] 20,300
```

The launcher runs the production `sessiond` source and the production web edge
(`buildApp`, compressed) with the caller's built client. It creates a **new**
owner-only `/tmp` directory and refuses an existing directory or an occupied
port. Inherited environment, credentials and live configuration are dropped.

Start it with the Forgerie process tool and **no** outer `flock`. The launcher
takes heavy slot 2 only for seeding and startup, and releases it at readiness or
failure. A separate `flock` holder process owns the lock descriptor, so the edge
and daemon never inherit it. If seeding and startup exceed `--seed-limit-sec`
(default 180, maximum 600), it prints `SEED_TIMEOUT`, releases the slot and
exits 1.

Readiness is `NATIVE_FIXTURE_READY /tmp/.../fixture.json seedMs=N`. Stop the
managed process with TERM; the launcher closes the edge, then its daemon.

Histories accept 2–8 comma-separated turn counts (1–1500 each). Each turn has
nine raw messages; each session adds one distinct marker reply. History is
written as native Durable entries (`pi.user`, `pi.assistant`, `pi.tool-result`),
one commit per turn, as a native run writes them. Legacy JSONL import is not
used. Session IDs are `00000000-0000-4000-8000-00000000000N` (N = 1, 2, …).

`fixture.json` is private (0600). It holds the origin, the daemon socket, the
session IDs, cwd, markers and a fixture-control token. It is an input, not
public evidence.

Startup acquires each session's runtime through the read-only command catalog,
because production native admission is active-owner-only. It then asserts that
real HTTP `/open` responses are native; it never relabels a classic response.
Opens are therefore **warm-owner** opens, not daemon-cold or OS-cold probes. The
provider is the SDK's controlled `faux` implementation; no paid call is made.

Fixture endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /__fixtures/metrics` | Edge PID, daemon PID, edge `process.memoryUsage()`. |
| `POST /__fixtures/restart-daemon` | Token-guarded graceful restart of the fixture's own daemon; reacquires owners. |
| `GET /__fixtures/spans?traceId=` | Token-guarded web spans for one trace (`--measure` only, last 10,000 kept). |

Forced-crash recovery is not covered. Verify a running fixture with:

```sh
node scripts/stack-latency-native-check.mjs /tmp/fg-native-UNIQUE/fixture.json --restart
```

It prints `NATIVE_FIXTURE_CHECK_OK` after native HTTP opens, the first native
WebSocket `session.open` frame, marker identity, and a `/proc` check that the
edge and the daemon hold no heavy-slot descriptor.

## Web edge measurement

`buildApp({ stackLatency: { sink } })` enables proxy measurement. Production
leaves it absent. Then, and only for a request with a valid
`x-forgerie-trace` (32 lower-case hex) on `session-open`, `process-list`,
`process-output`, `backlog` or `project-context` routes, the proxy:

- forwards the trace identity to the daemon;
- records web-clock spans: `transport` (daemon round trip seen by the web),
  `decode` (`JSON.parse` of the daemon body), and `serialize` (Fastify
  pre-serialization to `onSend`, which includes edge compression; it is an
  interval, not pure CPU);
- forwards the daemon's allow-listed numeric `Server-Timing` entries
  (`sessiond-admission`, `sessiond-execute`, `sessiond-serialize`) and drops
  descriptions and other entries.

Invalid traces are ignored; status, headers, bodies and errors do not change. A
failing sink never changes a response. Spans from different processes use
different clocks: correlate them by trace identity, never by subtraction.

```sh
node scripts/stack-latency-proxy-probe.mjs /tmp/fg-native-UNIQUE/fixture.json NEW.json 200 1,2
```

The probe sends serial `/open` requests directly to the daemon socket and through
the edge (gzip and identity), rotating order, and joins web spans by trace.

## Classic streaming cadence

```sh
node_modules/.bin/tsx scripts/fast-chat-open-server.mjs 18653 \
  --client-dir=/absolute/dist/client --stream-cadence=30hz --stream-tokens=300
node ui/scripts/stack-latency-fixture-interactions.mjs NEW.json http://127.0.0.1:18653
```

Cadences: `1hz` (default, unbounded without `--stream-tokens`, as before),
`30hz` (one token per 33 ms) and `burst` (25 tokens per 250 ms timer task).
Each token is one `.` after a fixed prefix (`ui/scripts/fixtures/stream-cadence.mjs`).
A bounded plan waits for `POST /__fixtures/streaming/start`, then commits exactly
the streamed text as the final message. The runner asserts that every planned
event was received once, and that the visible transcript holds exactly one copy
of the final reply with exactly the planned token count. Frame batching is
allowed. This is the classic event hub, not native or provider streaming.

## Switch pacing

The app pushes one history entry per session switch. Chromium ignores history
updates beyond 200 within 10 seconds in one document and logs "Throttling
navigation to prevent the browser from hanging" (crbug.com/1038223). The URL
then stays on the previous session while the selection, transcript and
composer move on, and the readiness predicate's route check fails. An
unpaced warm-switch run faster than about 50 ms per switch hits this on the
401st or 1001st push of a document; the earlier 398-switch live censor was
this throttle, not a product stall.

`ui/scripts/stack-latency-baseline.mjs` and the soak runner therefore keep
click starts at least `SWITCH_PACE_MS` (60 ms) apart. The idle gap is outside
every timed interval. The baseline runner takes an optional sixth argument,
`paceMs`; `0` reproduces the unpaced runner. It records `paceMs` and any
throttle warnings in its output.

## Soak runner

```sh
node scripts/stack-latency-soak.mjs --fixture=/tmp/fg-native-UNIQUE/fixture.json \
  --output=/tmp/forgerie-stack-latency/NEW-soak [--duration-min=480] [--warmup-min=30] \
  [--block-min=20] [--sample-sec=60] [--max-start-load=16]
```

Run the fixture and the soak as two managed processes. Both survive Forgerie
(coordinator) restarts. Reconnect phases restart the fixture daemon through its
token. A lost process is never restarted automatically; `samples.jsonl` is
appended every sample for inspection. The soak takes no heavy slot for its
lifetime; schedule it in a window agreed with the coordinator.

Phases: warm-up, then repeating blocks of quiet (40%), load (50%: verified
switches across all sessions, a draft round trip every 25 switches) and
reconnect (10%). Samples record browser heap, nodes, listeners and documents
(CDP `Performance.getMetrics`), edge RSS and heap, daemon RSS (`/proc`), host
load, switch latency and correctness counts. No forced GC or heap snapshot.

The summary compares post-warm-up start and end windows per metric:
`plateau`, `rising` or `insufficient`. `rising` is not a leak verdict. It also
records state after leaving the app document. Real phones, live provider TTFT,
tailnet direct-versus-relay and OS-cold caches are listed as unsupported.
Native streaming is not exercised. Watch lines: `SOAK_PHASE`, `SOAK_FAILURE`,
`SOAK_DONE`, `SOAK_REFUSED`. Exit 0 requires zero correctness failures.
