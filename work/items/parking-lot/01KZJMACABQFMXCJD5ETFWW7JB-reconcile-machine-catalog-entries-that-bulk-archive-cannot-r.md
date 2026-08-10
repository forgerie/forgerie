---
id: 01KZJMACABQFMXCJD5ETFWW7JB
slug: reconcile-machine-catalog-entries-that-bulk-archive-cannot-r
title: Reconcile machine catalog entries that bulk archive cannot resolve
origin: parked
status: To Do
priority: high
labels:
  - sessions
  - archive
  - bug
created: 2026-08-09
source: user
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: main
  repo: forgerie
---

# Reconcile machine catalog entries that bulk archive cannot resolve

## Why it matters

The machine-wide session catalog lists stale or path-mismatched sessions, but bulk archive fails them with `Session not found`. This blocked all 46 ROCKNIX sessions and smaller sets in Korri and Amaze Next, leaving users unable to clean up visible inbox entries.

## Acceptance Criteria

- [ ] Bulk archive resolves catalog-listed sessions by their actual catalog path or removes entries proven stale.
- [ ] Cleanup reports distinguish missing files from path-resolution mismatches.
- [ ] Regression tests cover sessions whose stored cwd does not map back to their physical session directory.

## Related

- `src/server/sessions/piSessionManagerGateway.ts`
- `src/server/sessions/piSessionService.ts`
- `src/server/sessions/sessionCatalogScanner.ts`
