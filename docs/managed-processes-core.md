# Managed process core

This is the server core for ADR 0007. `processTool.ts` registers the Forgerie-owned `process` tool and schedules watches. Session lifecycle integration is described below.
A managed process belongs to its originating session. It is not a workspace
service. A child process uses the same core; the child-agent lifecycle decides
when to stop it or keep it after its run finishes.

## Public interface

Import these modules directly. There is no barrel or global singleton.

| Module under `src/server/processes/` | Public contract |
| --- | --- |
| `managedProcesses.ts` | `ManagedProcesses`, `ManagedProcessesOptions`: one session owner over one launcher |
| `managedProcessTypes.ts` | `ManagedProcessLauncher`, `ManagedProcessStart`, `ManagedProcessRecord`, `ManagedProcessSnapshot`, `ManagedProcessState`, `ManagedProcessResult`, `ManagedProcessInputResult`, `ManagedProcessLaunchError` |
| `managedProcessLauncher.ts` | `prepareManagedProcessLauncher(environment?)`, `SystemdManagedProcessLauncher`, `AttachedManagedProcessLauncher`, `managedProcessUnits(sessionId, id)` |
| `managedProcessLog.ts` | `ManagedProcessLogCursor`, `ManagedProcessLogReadOptions`, `ManagedProcessLogBatch`; the log implementation itself is internal to the session owner |

```ts
const launcher = await prepareManagedProcessLauncher(agentEnvironment);
const processes = new ManagedProcesses({
  stateDirectory, sessionId, launcher, environment: agentEnvironment,
});
const recovered = await processes.initialize();
const started = await processes.start({ command: "exec python3 worker.py", cwd });
const input = await processes.writeStdin(started.id, "hello\n");
const batch = await processes.readOutput(started.id);
// First persist/fan out the events. Then advance the one durable read position.
await processes.acknowledgeOutput(started.id, batch.cursor);
await processes.dispose(); // systemd managed processes continue
```

| Method | Contract |
| --- | --- |
| `initialize()` | Acquire the session lease; classify all saved records. Never launch saved commands. An abruptly killed owner can leave a lease for approximately 10 seconds; retry `ELOCKED`, not launch. |
| `start({ id?, command, cwd, stopTimeoutSeconds? })` | Validate and persist intent before launch. The command runs through `/bin/sh -c`. Default timeout: 5 seconds; allowed: 0.1–3600 seconds. An omitted ID is a UUID. Existing IDs are never reused, even after a failed or uncertain launch. A rejected launch can still have started the command; inspect the saved record. `ManagedProcessLaunchError.id` identifies it without leaking the environment from a child-command error. |
| `list()`, `status(id)` | Return `state.kind = running`, `ended` with `{ result, code, status }`, or `lost`. Inspection errors reject; a temporarily unreachable manager is not proof of a lost process. |
| `writeStdin(id, stringOrBuffer)` | Return `written`, `stdin-full`, or `stdin-closed`, with the exact `bytesWritten`. On partial writes, retry only the unwritten **byte** suffix. No newline is added. A FIFO can briefly be unavailable while the wrapper starts. |
| `closeStdin(id)` | Explicit EOF request through the second FIFO. A closed writer, disposal, or restart does not request EOF for a systemd managed process. |
| `readOutput(id, { maxLines?, cursor? }?)` | Read without acknowledgement. Default batch: 1000 lines; maximum: 10,000. Omit cursor for the saved event-reader position. Start an independent panel/tool browse with `{ offset: 0, line: 1 }`; page with the returned cursor. |
| `lastOutput(id)` | Read the newest merged output line, including unfinished output, bounded to a 4 KiB UTF-8 suffix. Returns `null` for no retained output and marks a cut suffix with `truncatedStart`. Does not retain logs or change any reader position. |
| `acknowledgeOutput(id, cursor)` | Persist a returned cursor. Only the event dispatcher owns this acknowledgement, not a panel browse. Unacknowledged batches can replay after a crash; consumers deduplicate by process ID and line number. |
| `maintain()` | Apply log retention without advancing the event-reader position. The daemon-owned dispatcher spools unread events before scheduling retention, even when no runtime is open. Browsing output does not perform retention. |
| `stop(id)` | Initiate TERM and timeout escalation. Systemd uses `stop --no-block`. Poll status for completion. |
| `stopSession()` | Stop the session slice, including descendants that called `setsid`. Attached supervision waits for its owned commands to end. This does not archive/delete the session or delete its records. |
| `dispose()` | Release the session lease. Leave systemd managed processes running. Stop attached processes. Do not submit more operations once disposal starts. |

Identifiers match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. Cwd must be an absolute Unix
path, not `~`. One `ManagedProcesses` instance serializes all mutations and log
reads for that session. Do not manipulate its metadata while it owns the lease.
**Records include the private environment. Never send raw records/snapshots to a
browser or tool result.** Project only the fields those consumers need. Always
include the attached-process label when `supervision.kind === "attached"`.

The launcher port consumes validated, prepared records. Its operations are
`launch`, `inspect`, `stop`, `stopSession`, and `release`. `inspect` rejects when
supervision is unknown; it returns `gone` only on positive evidence. `release`
is idempotent and runs once after a terminal record has been read/persisted;
the core then writes the `released` marker and never calls it for that record
again. Tests
can supply a controlled implementation without starting units.

## Files and recovery

The layout is `<stateDirectory>/managed-processes/<sessionId>/<id>/`:

- `command.json`: versioned command, environment, ownership and launch intent.
- `output.log`: merged stdout/stderr, opened with `append:` by systemd.
- `read-position.json`: absolute base offset/line, the acknowledged cursor and
  an optional `reclaimed` receipt: the prefix length already punched. An absent
  initial file means offset 0, line 1. An absent receipt means "unknown".
- `result`: three newline-terminated fields: result, code, status. `ExecStopPost`
  writes it with fsync and atomic rename. Example: `signal\nkilled\nKILL\n`.
- `lost.json`: durable evidence that a process was classified lost.
- `released`: written after `release` succeeds for an ended or lost record.
  Every list, status and maintenance pass classifies every record, and a
  systemd `release` starts a `systemctl` child from the sessiond main thread.
  Without the marker that cost grows with every finished record. A failed
  `release` writes no marker, so the next read retries it.
- `stdin`, `stdin.eof`: mode-0600 FIFOs.
- `keeper.sh`, `result.sh`: copied launch helpers, independent of a Forgerie
  source/build-directory move. Temporary metadata files can remain after a crash.

Directories use mode 0700; private files use 0600. Records are read from disk,
not from a second inventory. A directory without `command.json` is an incomplete
preparation, not a command to retry. Startup never re-runs a command.

A saved result wins over unit liveness. Otherwise a live unit is running; a
missing supervisor becomes a lost process. The core re-reads the result after
observing that a supervisor is gone to close the exit/inspection race.

Sessiond reuses a positive `inspect` answer for 15 seconds (`livenessCacheMs`;
the core default is 0, which asks on every read). The process watcher reads
every record each second, and a systemd `inspect` starts a `systemctl` child
from the sessiond main thread. A published result still wins at once, so a
normal exit appears within one watcher pass. An explicit stop, session stop or
child stop forgets the answer. Only a supervisor that vanishes without writing
a result is classified lost up to 15 seconds late. Negative answers and
inspection errors are never reused. Failed
units are collected automatically; `release` also resets a retained failed unit
by its exact name. It does not reset unrelated units.

## Systemd and attached supervision

The session component of `forgerie-proc-<session>-<id>.service` is the SHA-256 of
the session ID. The slice is `forgerie-proc-<session>.slice`. This avoids UUID
dashes creating additional ancestor slices. Use `managedProcessUnits`, not a
second naming implementation.

The user-manager probe matches `LocalWorkspaceServicesLauncher.prepare()`:
`systemctl --user show --property=SystemState`. Unlike workspace services, an
unavailable manager permits an explicitly labelled attached process.

The systemd launcher uses `Type=exec`, `KillMode=control-group`,
`TimeoutStopSec`, `--expand-environment=no`, and the `WorkingDirectory` property.
It does not use `RemainAfterExit`. `StandardInput=null` also applies to
`ExecStopPost`, so the hook cannot hang opening stdin. Percent signs in transient
D-Bus path properties are literal; do not double them as if writing a unit file.
The command is passed as an argv element, not interpolated into the wrapper.

The copied result hook runs with `/bin/sh`, not the Node executable from launch
time. Launcher preparation rejects a missing or non-executable `/bin/sh`. The
hook uses shell builtins and GNU `sync` plus `mv` from stable system paths:
`/run/current-system/sw/bin` on NixOS, then `/usr/bin` or `/bin`. It does not use
the command's PATH or resolve those paths to a Nix store path. GNU `sync` with a
file operand calls fsync: the hook flushes `result.tmp`, renames it to `result`
on the same filesystem, then flushes the containing directory. Failures stop
the hook. The result keeps its three-line format and mode 0600.

The keeper opens stdin with `exec 3<>fifo`. A helper owns that write end while
the wrapper execs the command. Opening/closing `stdin.eof` releases the helper.
Writes use `O_NONBLOCK`, at most 4096 bytes per write, and expose EAGAIN as
`stdin-full`. Large messages are not atomic across different writers.

The attached launcher starts a child in its own process group. A separate
lifeline pipe, **not stdin**, ends it when Forgerie dies. A helper sends TERM,
then KILL after the timeout, including if Forgerie itself receives SIGKILL.
Normal exit status is saved by its Forgerie parent. After abrupt parent death,
a new owner reports a lost process if no result was saved. Attached supervision
cannot contain a descendant that deliberately leaves its process group; only
the systemd launcher provides whole-cgroup containment.

The command receives the same agent-visible filter as workspace services,
including PATH. The launcher removes inherited user-manager keys that are not
in this explicit environment. Defaults are `PYTHONUNBUFFERED=1`,
`PYTHONIOENCODING=utf-8`, `GFORTRAN_UNBUFFERED_ALL=y`, `NSUnbufferedIO=YES`, and
`NO_COLOR=1`; caller environment values can override them. These do not force
all programs to flush. Use `stdbuf -oL` where appropriate. Environments remain
visible to the same OS user through unit properties and private state files.

## Log retention and line identity

The default cap is 64 MiB of retained bytes, not the log's apparent file size.
Copy-and-truncate loses writes between the copy and truncate. Rename leaves
systemd appending to the old inode. Neither is safe here.

Instead, retention samples the append file's size, scans the discarded prefix
for newlines, commits its absolute base offset and line number, then punches a
hole in that prefix with `fallocate --punch-hole --keep-size`. The inode and
append offsets never move. Concurrent appends are beyond the sampled range.
A crash after metadata commit but before punching only leaves extra allocated
blocks; the next maintenance call retries reclamation. Only a successful punch
records the `reclaimed` receipt. A pass whose base did not advance, and whose
base equals the receipt, neither saves the file nor runs `fallocate`. The first
unchanged pass after an advance records the receipt, so each advance costs one
extra punch and save. Older code ignores and drops the receipt, which costs at
most one repeated punch; no migration is needed in either direction.

Line numbers start at 1 and never reset. A cap that cuts a line keeps the
surviving tail with `truncatedStart: true`. `droppedLines` reports complete lines
removed since the requested cursor. A still-running, unterminated line waits
for its newline. After an ended/lost result, its final unterminated tail is one
line with `terminated: false`. Acknowledging it prevents another delivery.
Text decodes as UTF-8; a cut through a code point can yield a replacement
character, with the truncation flag set.

The reader reads at most 64 KiB per filesystem read and stops after the requested
line count, rather than loading the remaining retained log for every batch.
A batch can read ahead by less than one chunk. Long lines need multiple chunks;
only an unfinished line is buffered across chunks, and UTF-8 decoding waits
until the line is complete. A running unterminated line still needs to be read
again on the next call because its cursor has not advanced. Retention scans
remain separate and can read the discarded prefix when applying the cap.

`ManagedProcessLog.readTail(ended, maxLines)` returns the newest lines exactly
as a browse from `{ offset: 0, line: 1 }` numbers and marks them, with the same
end cursor. `droppedLines` counts every earlier line, including retention's.
It runs retention like `read()` and never moves the event-reader position. It
counts newlines forward from the newest known line start (the acknowledged
cursor after a newline, otherwise the base), then decodes only the returned
lines. With no acknowledged reader it still reads the retained bytes once.

The reader preserves the shared file's newline order. It cannot separate
stdout from stderr or repair application writes that interleave inside a line.
In the real acceptance test, 50 simultaneous pairs of 100,000-byte lines, one
`write` per line, produced 100 lines and **zero** mixed lines on this host.
Splitting each of two logical lines into two 50,000-byte writes produced **one**
mixed line. That is application write framing, not a reader boundary to infer.

### Limits to carry into integration

- The cap applies when reads/maintenance run, with filesystem-block rounding.
  Output can exceed it while Forgerie is down or between maintenance passes.
  A strict offline disk quota would need a different writer or host quota.
- Physical reclamation requires Linux `fallocate` and a filesystem with hole
  punching. Unsupported hosts/filesystems report a retention error; they do not
  silently copy-truncate. Attached launching itself does not require systemd.
  Non-Linux retention needs a separate implementation and is not proven here.
- The logical sparse-file size grows. Use allocated-size tools (`du`), and
  sparse-aware backup/copy. Do not externally rotate or truncate the log.
- The result hook requires GNU `sync` and `mv` at the stable system paths above.
  It reports an error if they are unavailable; it does not publish an unflushed
  result. No Node GC root is needed for newly launched units. Units launched
  before this fix still use their original Node hook and need that executable
  retained until they exit; this change does not alter live unit properties.
- The result hook can fail if its cwd disappears or the disk is full. Without
  a saved result, recovery reports lost; it never guesses success.
- No reboot, OOM, physical power-loss, remote filesystem, or non-Linux proof was
  run. Unit tests cover the missing-supervisor recovery decision.
- The tool/watch integration must add missed event delivery.
  Watch acknowledgements must follow durable event acceptance. This core does
  not claim exactly-once event delivery.

## Verification

On Linux with Node 24, a systemd user manager, Python 3, `mkfifo`, `fallocate`,
`setsid`, and `/bin/sh`:

```sh
npm run typecheck
npm run lint
npm run knip
npm test -- src/server/processes
npx tsc -p tsconfig.build.json
node scripts/verify-managed-processes-restart.mjs
```

The proof launches from a temporary `KillMode=control-group` parent unit. It
checks independent cgroups, continued stdin after parent death, explicit EOF,
exit results, SIGKILL, session slice timeout/setsid containment, full stdin,
large concurrent writes, environment/path quoting, and the attached lifeline.
It stops only its own units and removes its empty ancestor slice if no other
session uses it. It never restarts `forgerie-sessiond` or `forgerie-web`.

## Session lifecycle

`PiSessionService.getManagedProcesses(sessionId)` shares one owner per session.
Sessiond restores every saved owner before Durable recovery and schedules
`maintain()` every 30 seconds, including idle sessions. Runtime disposal,
handoff, and fork do not move or stop managed processes. Daemon shutdown
releases owners; only attached processes stop on that shutdown.

Session close (archive, delete, or worktree removal) calls `closeSession()`.
It stops the session slice, waits for terminal status, then removes records
and logs under the owner lease. A stop or inspection failure keeps the evidence
and fails the close. Land, Discard, archive cleanup, and scheduled/manual
worktree cleanup share the same pre-removal hook. Workspace services keep their
separate shutdown hook. The registry then disposes the owner and removes its
empty directory. Session close also deletes the originating session directory's
`<sessionId>.process-watches.json`; daemon/runtime disposal leaves it intact.

Version 1 records now optionally contain `child: { name, runId }` and
`keepAfterChild`. Old records without these fields remain session-owned.
`setKeepAfterChild(id, keep)` persists a keep decision. `stopChild(child)` stops
only running processes from that exact child run unless kept. Durable's
`DurableChildRunRecords` invokes the terminal callback for answered, failed,
and stopped runs before saving completion, including recovered completions.
A kept child process still belongs to the original session.

Maintenance retains the newest 50 finished records (ended or lost), ordered
by result/lost-record filesystem timestamp, then creation time and ID. It never
removes running records. `clearFinished()` uses the same removal path, removes
all finished folders, and returns their IDs. The existing 64 MiB log cap and
its offline limits still apply. Closing a browser is not session close.

## Browser projection

`managedProcessPanel.ts` reads the session registry through `getManagedProcesses`.
It uses the registry's shared, daemon-owned tool dispatcher for names and
intentional Stop bookkeeping. Runtimes attach and detach delivery without
disposing that dispatcher. Archived/read-only runtimes have no process panel
owner.

Polling emits `processes.update` and independent `processes.output` batches.
The panel polls every 1 second while any process is running or terminating,
and every 10 seconds otherwise. Constructor options `activeIntervalMs` and
`idleIntervalMs` override these defaults. Tool mutations (start, stop, write,
clear, and update) and browser stdin writes refresh the panel immediately;
disposal removes the mutation subscription. The daemon-owned watch dispatcher's
polling interval does not change.

`GET /sessions/:id/processes/:processId/output` and `processes.output` carry
additive position fields. Each line has its absolute `number`, `terminated`,
and `truncatedStart`. A batch has `cursor: { offset, line }`: the absolute byte
offset and next unread line number from `ManagedProcessLogBatch`. Positions
belong to one process in one session, not to a browser connection. They survive
retention and daemon reconnects. Running partial lines still wait for a newline;
an ended process can emit one final line with `terminated: false`.

HTTP tails retain at most 200 lines. HTTP tails and pushed batches have a 32 KiB
text budget. A clipped line keeps a UTF-8-safe suffix and `truncatedStart: true`,
without changing its line number or the batch cursor. `droppedLines` counts
lines omitted by retention and the transport budget; HTTP tails also count
lines omitted by the requested tail limit. Clipping never changes the full log.

The browser applies snapshots directly. A pushed snapshot supersedes an older
in-flight HTTP snapshot or its failure. The selected output reconciles HTTP
cuts and live batches by line number, retains at most 200 lines, and preserves
live lines beyond an older HTTP cut. Repeated text at distinct positions remains
distinct. Missing positions (older daemons) or a gap trigger an authoritative
HTTP refresh, never text-based deduplication. Manual refresh and reconnect also
read the authoritative tail; the browser does not poll. Optional position fields
keep existing HTTP clients compatible.

Panel browsing never acknowledges the watch reader. Snapshots include
`lastLogLine` from a bounded tail read, so list rows update even while the
newest line is unfinished. Browser payloads allowlist fields; launch environments
and private file paths never leave the server. The launcher does not expose a
PID or completion timestamp, so the compatible fields remain `pid: 0` and
`endTime: null`, not invented observations.
