---
id: 01M06SX5MWA4NH0G8T2X863JNJ
slug: redesign-multi-account-usage-meters-in-the-profile-extension
title: Redesign multi-account usage meters in the profile extension
origin: parked
status: To Do
priority: low
labels:
  - design
  - profile-extension
  - out-of-repo
created: 2026-08-17
source: se-work
context:
  repo: forgerie
  invoked_by: se-work slice 4
---

# Redesign multi-account usage meters in the profile extension

## Why it matters

The inbox shelf rendered by ~/.pi/agent/extensions/multi-account-usage.ts shows unlabeled bars and numbers (Claude 5h/2h/7d/5d, Codex) that only the author can decode. The Forgerie polish program (Slice 4) fixed all in-repo metadata copy, but this meter lives in the pi profile, outside the repo and its release, so it needs its own pass: label the quota windows, align the bars to the new calm palette, and make the reset times legible.

## Related

- `work/items/active/01M013K7Q4VXN2R8TJ5W9EBHCD-ui-polish-design-language/plan.md`
