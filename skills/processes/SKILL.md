---
name: processes
description: Start, inspect, watch, and stop managed processes with Forgerie's process tool. Use for commands that continue while the agent works, including builds, watchers, local APIs, and interactive commands.
---

# Managed processes

Use `process`, not `&`, `nohup`, `disown`, or `setsid`. Check `list` before starting a duplicate. Give each managed process a specific name.

A managed process belongs to the session that starts it. It survives a Forgerie restart. Session close (archive, delete, or worktree removal) ends it. A handoff or fork does not transfer it. A workspace service is different: the worktree owns it and declares it in its services file.

An **attached process** ends when Forgerie restarts. Every result labels it. A **lost process** is ended with reason `supervisor lost`; Forgerie never runs it again by itself. Check the effect of the old command before you decide to start another.

## Start, then move on

```json
{"action":"start","name":"web-preview","command":"npm run dev","notify":{"onSuccess":"context","logMatches":[{"pattern":"ready"},{"pattern":"EADDRINUSE","on":"turn"}]}}
```

`name` and `command` are required. `cwd` defaults to this agent's working directory. Commands run through `/bin/sh -c`.

After start, move on or end your turn. Do not sleep, hold your turn, or poll output for readiness. Watches notify you. For programs that still hold back output, use `stdbuf -oL program args`. Python is unbuffered by default.

A **child process** ends when its Durable child run finishes. If you start something for your parent to use, set `keepAfterChild: true` and say so in your report. Include the process ID and purpose. This option defaults to false and is ignored when starting outside a child. `update` can change it later for a child process.

```json
{"action":"start","name":"parent-preview","command":"npm run preview","keepAfterChild":true,"notify":{"logMatches":[{"pattern":"listening"}]}}
```

## Attention and missed events

- `turn`: wakes the agent, including when idle.
- `context`: records model context without waking the agent. An idle agent sees it next time it works.
- `ignore`: records the event, but never delivers it to the model or wakes it.

Exit defaults: `notify.onSuccess: "turn"`, `onFailure: "turn"`, `onKilled: "context"`. An intentional `stop` does not notify. Keep `turn` for a build or test result that requires action.

A watch in `notify.logMatches` takes `pattern`, `mode` (`literal` by default, or `regex`), `repeat` (false by default), and `on` (`turn` by default). There can be at most 20 watches, with at most 500 characters in each nonblank pattern. A once-only watch remains fired after a restart. Repeat watches have a 15-second cooldown while Forgerie runs; resume groups offline matches into one summary.

stdout and stderr share one ordered log. The compatible `stream` selectors (`stdout`, `stderr`, `both`) all inspect that merged log. They cannot isolate a stream.

On resume, Forgerie reports **missed events** as one session summary. Each event keeps its requested attention; any `turn` watch wakes the agent once, not once per match. Summary samples are bounded; use `output` or read the log for more. Process IDs and absolute line numbers identify output across restarts.

## Other actions

- `list`: optional `statuses` (`all`, `running`, `finished`, `failed`, `terminating`, `terminate_timeout`, `killed`), `sortBy` (`startTime_desc`, `startTime_asc`, `name_asc`, `name_desc`, `status_asc`), and `limit`.
- `output`: requires `id`. Optional `tailLines` (default 100, maximum 2000), `pattern`, and `mode`. Returns absolute line numbers and at most 50 KiB. Reading output does not consume watch events. `stdoutFile` and `stderrFile` name the same merged log; use `read` for deeper inspection.
- `write`: requires `id` and `input`, or `end: true` for EOF. Adds no newline. With both, EOF follows only a complete write. If stdin is full, retry only the unwritten **byte** suffix, using `bytesWritten`. Closing the tool/runtime does not send EOF.
- `stop`: requires `id`. Sends TERM, then KILL after the timeout to the whole managed process group. Stop obsolete commands and duplicates.
- `clear`: removes only ended records and their logs. It never removes a running managed process.
- `update`: requires `id` of a running managed process. Change `name`, `keepAfterChild`, exit `notify`, or `watches` without restarting it.

```json
{"action":"update","id":"ID_FROM_START","watches":{"mode":"append","items":[{"pattern":"job completed","repeat":true,"on":"context"}]}}
```

`watches.mode` is `append`, `replace`, `remove`, or `clear`. Append/replace items need a pattern. Remove items use `index` or `pattern`; index takes precedence. Clear needs no items. New watches start from current output, not old lines. Tighten noisy patterns, remove `repeat`, or use `ignore` instead of restarting the command.
