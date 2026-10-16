# Managed processes

Use the Forgerie-owned `process` tool and `skills/processes/SKILL.md` for managed processes. A managed process belongs to its originating session, survives Forgerie restarts with systemd user supervision, and ends at session close. An attached process ends when Forgerie restarts. Never rerun a lost process automatically.

A child process ends with its child run unless `keepAfterChild: true` is set. Report the kept process ID and purpose to the parent. Workspace services remain worktree-owned and separate.

The registry owns launch records and logs. Records contain private environment values. Browser and tool payloads must project public fields, never serialize records. Panel output reads do not acknowledge the durable watch reader. See `docs/managed-processes-core.md`, ADR 0007, and the Processes section of `CONTEXT.md`.

Engineering and verification guidance lives in `.agents/skills/code-quality-architecture/SKILL.md`, `.agents/skills/testing-guide/SKILL.md`, and `docs/testing.md`. User-facing managed process guidance belongs in `docs/plugins.md#managed-processes`.

For session-history, usage or skill-load audits, read docs/session-audits.md first.
