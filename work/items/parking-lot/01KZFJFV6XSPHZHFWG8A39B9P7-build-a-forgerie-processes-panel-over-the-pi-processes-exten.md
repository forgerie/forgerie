---
id: 01KZFJFV6XSPHZHFWG8A39B9P7
slug: build-a-forgerie-processes-panel-over-the-pi-processes-exten
title: Build a Forgerie processes panel over the pi-processes extension
origin: parked
status: Done
priority: medium
labels:
  - forgerie
  - plugins
  - web-ui
created: 2026-08-08
source: user
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: main
  repo: forgerie
---

# Build a Forgerie processes panel over the pi-processes extension

## Why it matters

The pi-processes dock and /ps and /logs TUI views are invisible in Forgerie, so a user cannot see whether agent-started servers or watchers run. A web panel makes process state verifiable in the product instead of trusting model claims. Validated live: the process tool works in sessiond sessions, so only the surface is missing.

## Acceptance Criteria

- [x] A workspace or session panel lists managed processes with name, status, pid, and uptime
- [x] Recent stdout and stderr logs are viewable per process
- [x] Stop and write actions work from the panel
- [x] State updates live while a process starts, logs, and exits
- [x] Implemented with the pi-web-plugins pattern plus a sessiond bridge, no TUI widget bridging

## Related

- `pi-web-plugins/workspace-tasks`
- `src/server/sessions/piSessionService.ts`
- `work/items/parking-lot/01KZF4JF5TPQA7C6F4ZXC84ESZ-render-pi-processes-custom-messages-from-details-instead-of-.md`
