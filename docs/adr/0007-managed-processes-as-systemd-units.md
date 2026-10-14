# Managed processes run as transient systemd user units

Status: proposed, 2026-10-14

Durable sessions resume after Forgerie restarts, but the bundled `@aliou/pi-processes` kills every process on `session_shutdown`. Its processes also live in `forgerie-sessiond.service`'s cgroup, so systemd kills them when sessiond stops. Upstream plans persistence across reloads only, not across a restart of the host process.

Forgerie replaces `@aliou/pi-processes` with its own `process` tool. The tool keeps the same name and action schema. Each managed process is a transient unit started with `systemd-run --user`, in one slice per session. Forgerie runs no supervisor daemon of its own.

- A small wrapper is the unit's `ExecStart`. It holds the write end of the process's stdin pipe and then `exec`s the command, so the command stays the main process. EOF comes only on an explicit request. A Forgerie restart does not close stdin.
- stdout and stderr go to one log file with `append:`. An `ExecStopPost` hook records the result, the exit code and the signal. That record is correct for exit, failure, a stop past `TimeoutStopSec`, and an outside SIGKILL.
- A stop sends SIGTERM to the whole cgroup, then SIGKILL after a timeout. Stopping the session slice ends every process the session owns, including ones that called `setsid`.
- Forgerie watches log files and records how far it has read. On resume it reports missed events with the attention level each watch asked for.

## Considered options

- **Process Compose, as used for workspace services.** A spike against the pinned v1.120.0 ruled it out. It has no call to add one process: `POST /project` replaces the whole set, and two concurrent calls crash the instance. It keeps 1000 log lines in memory, with offsets that shift and no line index. It cannot pipe stdin to a process that is not interactive. Its stop has no SIGKILL fallback.
- **Patching `@aliou/pi-processes`.** It would need detaching, saved state and reattaching, which is far more than the two small patches the vendor README allows.
- **Re-running commands on resume.** In-memory state would be lost, and repeating an arbitrary command can be unsafe.

## Consequences

- Hosts without a systemd user manager get attached processes. These end when Forgerie restarts, and Forgerie labels them that way in the tool result and the panel.
- The unit does not get the caller's environment by default. Forgerie passes the agent-visible environment, including `PATH`, explicitly, and launches with `--expand-environment=no` so that `$` in a command reaches the shell unchanged.
- A process that is not attached to a terminal block-buffers its output. Without line buffering, logs and watches stay silent until the process exits.
- If the supervisor is lost (reboot, OOM), Forgerie reports each affected process as a lost process and does not run it again.
- The change replaces `@aliou/pi-processes` in one step. A copy of it installed in the Pi profile is dropped from hosted sessions with a warning.
