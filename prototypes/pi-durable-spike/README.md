# Pi Durable crash-recovery spike

Date: 2026-10-06. Package: `@earendil-works/pi-durable` 1.0.4 (experimental).
Throwaway code. It is not wired into Forgerie's daemon or UI.

## Question

Today a sessiond restart kills every in-flight agent run (see
`AGENTS.local.md`). Does Pi Durable really continue a run after its process is
killed with `SIGKILL`, and what does it need from the host?

## Setup

`spike.mjs` opens a Harness over SQLite storage and talks to the local
CLIProxyAPI through a custom pi-ai provider (`openai-completions`,
`deepseek-v4.1-flash`). One job, submitted with a fixed `requestId`, asks the
model to call two slow tools:

- `fetch_reading`, declared `replay: "safe"`.
- `record_result`, not replayable. It appends to `permanent.log`, the side
  effect that must not happen twice.

Each tool logs every attempt with its task id and process id.
`crash-test.sh` kills the process at a chosen point and resumes it from storage.
`two-owners.sh` opens the same storage from a second process.

Run from this directory: `npm install`, then `./crash-test.sh <name> <marker|seconds>`.

## Results

| Test | What happened | Verdict |
|---|---|---|
| Baseline, no kill | Both tools once, answer `DONE 42`, one line in `permanent.log` | Works |
| Kill inside `fetch_reading` (safe) | Resume reran task 12 from the start, then ran `record_result` once. Same submission id (8) in both processes. One log line | As documented |
| Kill inside `record_result` (unsafe) | Not rerun. The model got `Tool record_result was interrupted and may have partially run`, plus the 3 output lines committed before the kill. It chose not to repeat the call and answered `DONE 42`. Zero log lines | As documented, and the model handled it well |
| Kill 1 s in, during the model's answer | The cut-off answer stayed in the transcript with `stopReason: "aborted"`. The request was sent again; both tools then ran once | As documented |
| Second process opens the same storage mid-run | Nothing stopped it. Both processes ran task 12; the second reran `fetch_reading` 7 more times and never settled (killed by a 60 s timeout). The unsafe tool still ran once | **Not safe. The host must enforce one owner** |

Harness open time on reopen: 8 ms. Resume needed no code beyond
`harness.resume()` and re-submitting with the same `requestId`.

## What this means for Forgerie

- The headline claim holds: a killed process loses no run. A sessiond restart
  could become a pause instead of a loss.
- The guarantee is per tool. Only tools declared `replay: "safe"` rerun. A cut-off
  `bash` call is reported to the model, not repeated. Forgerie would have to
  decide replay safety for every tool it offers, including extension tools.
- Pi Durable assumes one owning process per storage and does not enforce it. The
  Node SQLite adapter has only `busyTimeoutMs` and `walAutoCheckpointPages`.
  Forgerie would need a lock (for example an exclusive lock file held by sessiond)
  before any second process may open the storage. Forgerie's web server must
  attach to sessiond, never open the storage itself.
- Not tested: memory with thousands of conversations, the `watch()` stream for
  browser clients, subagents, compaction, and porting Pi coding-agent extensions.
  Each of these needs its own spike before a migration decision.
