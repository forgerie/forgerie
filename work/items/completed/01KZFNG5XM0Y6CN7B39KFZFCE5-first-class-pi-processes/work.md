# First-class pi-processes support

- **Id:** 01KZFNG5XM0Y6CN7B39KFZFCE5
- **Status:** completed
- **Created:** 2026-08-07
- **Skill:** se-plan (solo mode; no upstream requirements doc)

## Origin

Direct prompt following a live debugging session in the Forgerie web UI that
established:

- Agent-claimed servers die because backgrounded processes inherit the bash
  tool's stdout pipe (EPIPE) or are killed by tool timeouts — not because pi
  kills children at turn end.
- The `process` tool (pi-processes) is the right primitive but spawns through
  `bash -lc`, which on NixOS rebuilds `PATH` and loses the daemon's curated
  toolchain (`node: command not found`, exit 127).
- The config-only fix (`execution.shellPath` wrapper) failed live validation:
  within one daemon, some spawns honored the configured shell and others fell
  back to the hard-coded system bash. Root cause unknown.
- pi-processes' TUI surfaces (dock, `/ps`, `/logs`) are invisible in Forgerie;
  its `ad-process:notification` custom messages render as raw model-facing XML.

## Absorbed backlog items

- `01KZF4JF5TPQA7C6F4ZXC84ESZ` — render pi-processes custom messages from
  details instead of raw XML (promoted 2026-08-07)
- `01KZFJFV6XSPHZHFWG8A39B9P7` — build a Forgerie processes panel over the
  pi-processes extension (promoted 2026-08-07)

## Artifacts

- `plan.md` — implementation plan (se-plan)
