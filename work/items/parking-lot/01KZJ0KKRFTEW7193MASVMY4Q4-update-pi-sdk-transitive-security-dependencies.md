---
id: 01KZJ0KKRFTEW7193MASVMY4Q4
slug: update-pi-sdk-transitive-security-dependencies
title: Update Pi SDK transitive security dependencies
origin: parked
status: To Do
priority: high
labels:
  - security
  - dependencies
  - pi-sdk
created: 2026-08-09
source: se-work
context:
  cwd: .
  branch: main
  commit: 2ecc240
  repo: forgerie
---

# Update Pi SDK transitive security dependencies

## Why it matters

The self-contained package audit exposes vulnerable transitive versions under @earendil-works/pi-coding-agent 0.83.0: undici 8.5.0 and brace-expansion 5.0.7. Forgerie already executed this SDK at runtime, but bundling pi-processes causes npm to classify the optional peer chain as production and makes the risk visible in `npm audit --omit=dev`.

## Acceptance Criteria

- [ ] `npm audit --omit=dev` reports no high-severity findings
- [ ] The Pi SDK and lockfile use compatible fixed transitive versions
- [ ] `npm run verify` and the installed-package smoke test pass

## Related

- `package.json`
- `package-lock.json`
- `scripts/smoke-package-install.mjs`
