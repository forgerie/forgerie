---
id: 01M0DXHCMF5JYZWXECK3SPYRQM
slug: repair-knip-dependency-and-binary-configuration
title: Repair Knip dependency and binary configuration
origin: parked
status: To Do
priority: medium
labels:
  - tooling
  - verification
created: 2026-08-19
source: se-work
context:
  cwd: .
  branch: fix-transcript-hydration-responsiveness
  repo: forgerie
  invoked_by: interactive-responsiveness
---

# Repair Knip dependency and binary configuration

## Why it matters

`npm run verify` fails after typecheck and lint because Knip reports `tsx` as unused and seven package-script binaries as unlisted. This blocks normal full verification for unrelated changes.

## Acceptance Criteria

- [ ] `npm run knip` passes.
- [ ] Package scripts keep working under Node 22.
- [ ] Knip lists script-only binaries through the repository's intended configuration instead of suppressing real unused dependencies.

## Related

- `package.json`
- `knip.json`
