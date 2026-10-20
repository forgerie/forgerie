# Stack latency spans

Forgerie can record bounded latency spans for measurement runs. Production records nothing. This page covers the daemon side. The span schema lives in `src/shared/stackLatency.ts`; it is the only wire definition.

## What is recorded

A span has a 32-character hex trace ID, an operation, a phase, a start and a duration in milliseconds, an outcome, and optional counts. It never holds titles, message text, paths, session IDs, tool arguments, environment values or secrets. A trace ID never authorizes anything.

`GET /sessions/:id/open` records these phases when measurement is on:

| Span | Parent | Boundary |
| --- | --- | --- |
| `admission` | request | Fastify `onRequest` hook to the start of `PiSessionService.open`. Includes routing and query validation. |
| `execute` | request | `PiSessionService.open` call to its result. |
| `admission` | `execute` | Open preparation: owner lookup, Durable flush, unread receipt, read-only, archive and worktree checks. |
| `storage-read` | `execute` | Native `DurableSessionReader.openAddress`, or the saved-file read for an inactive classic session. |
| `storage-read` | native `storage-read` | One read-model preparation attempt: required documents, binding check and, without an attached publisher, the entry scan. |
| `projection` | native `storage-read` | Browser messages for the cut, inside the commit. With an attached publisher it reuses the committed history. |
| `projection` | `execute` | Image references and receipt for native opens; the in-memory cut for an active classic session. |
| `serialize` | request | Fastify `preSerialization` hook to `onSend`. This is an interval, not pure CPU time. |

Nested spans name their parent span. Do not add a nested span to its parent. The open path has no queue, so it records no `queue` span. Clocks are process-local. Correlate spans from different processes by trace ID; do not subtract their absolute times.

When a request is measured, the daemon also returns a numeric `Server-Timing` header with `sessiond-admission`, `sessiond-execute` and `sessiond-serialize`. Only top-level spans appear there.

Each request records at most 512 spans within five minutes. An observer failure is counted. It never changes the response or its error.

## Turning it on for a temporary profile

`PI_WEB_STACK_LATENCY_FILE` is a measurement switch for temporary profiles. Do not set it on a deployed service.

```sh
PI_WEB_STACK_LATENCY_FILE=/tmp/my-profile/spans.jsonl forgerie-sessiond
```

- Unset or empty: no sink, no route hooks and no startup work. A client `x-forgerie-trace` header alone records nothing.
- The path must be absolute. The daemon does not follow a symlink there. It creates the file with mode `0600` and refuses a non-regular file.
- Each line is one span. The file is capped at 64 MiB, and at most 4,096 lines wait to be written. Spans beyond either limit are dropped and counted.
- Writes happen after the response path, so a slow or failing file never delays or fails a request. On shutdown the daemon logs written, dropped and error counts.
- Like all `PI_WEB_*` keys, the variable is removed from agent and child process environments.

A request is measured only when the switch is on and the request carries a valid `x-forgerie-trace` header. The web edge forwards that header only on its own opt-in measurement path.

## Event hub ownership counts

`SessionEventHub.diagnostics()` returns scalar counts: session socket buckets, session sockets, global sockets, host observers, sequence watermarks and host-output sessions. A browser socket bucket is removed when its last socket closes or fails. Sequence watermarks stay, so a reattached browser continues the same sequence. These are counts, not heap measurements.
