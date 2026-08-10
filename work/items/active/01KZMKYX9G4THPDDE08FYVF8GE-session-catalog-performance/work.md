---
id: 01KZMKYX9G4THPDDE08FYVF8GE
slug: session-catalog-performance
title: Bound session catalog work across startup
status: active
created: 2026-08-09
source: se-plan
artifacts:
  - plan.md
---

# Bound session catalog work across startup

Reduce Forgerie's session-catalog cost across archive persistence, sessiond,
the web proxy, and the browser. The work follows a live diagnosis that found
unbounded archived prompts, repeated archive-index parsing, duplicate startup
snapshots, and avoidable inbox derivation work.
