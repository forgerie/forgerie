---
id: 01M0DZG8Q1Y0NWYEAM3177F662
slug: make-local-forgerie-deployments-atomic-across-concurrent-wor
title: Make local Forgerie deployments atomic across concurrent work
origin: parked
status: To Do
priority: high
labels:
  - deployment
  - reliability
  - concurrency
created: 2026-08-19
source: se-work
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: main
  commit: 5782ff4
  repo: forgerie
  invoked_by: user
---

# Make local Forgerie deployments atomic across concurrent work

## Why it matters

Concurrent builds clean and replace the shared dist directory in place. This caused a transient 404 and deployed unrelated dirty chat changes that regressed bottom-first opening by 3,042 px. A deployment must publish one verified commit without exposing partial output or uncommitted work.

## Acceptance Criteria

- [ ] Build into a commit-specific temporary directory instead of the live dist directory.
- [ ] Atomically switch the live artifact only after a successful build.
- [ ] Serialize deployments so concurrent agents cannot overwrite each other.
- [ ] Record or expose the deployed commit and reject accidental dirty-source deployment.
- [ ] Keep sessiond running when only web/client files changed.

## Related

- `AGENTS.local.md`
- `package.json`
- `dist/`
