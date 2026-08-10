---
id: 01KZKYWRJTKT7GYBP5TACAZ87W
slug: restore-subagent-startup-with-bundled-pi-processes
title: Restore subagent startup with bundled pi-processes
origin: parked
status: To Do
priority: high
labels:
  - tooling
  - subagents
  - pi-processes
created: 2026-08-09
source: se-plan
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: main
  repo: forgerie
  invoked_by: se-plan
---

# Restore subagent startup with bundled pi-processes

## Why it matters

All planning and research subagents fail before starting because bundled pi-processes extension modules import @earendil-works/pi-tui, which is not resolvable in child sessions. This blocks required multi-agent planning and review workflows.

## Acceptance Criteria

- [ ] A fresh subagent can start from the Forgerie repository without pi-processes extension load errors.
- [ ] Bundled pi-processes declares or resolves every runtime dependency needed by its extension entrypoints.
- [ ] A regression check covers child-session extension startup.

## Related

- `vendor/pi-processes`
- `package.json`
