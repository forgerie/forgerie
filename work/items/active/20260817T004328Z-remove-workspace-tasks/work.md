---
id: 20260817T004328Z
slug: remove-workspace-tasks
title: Remove Workspace Tasks
status: active
created: 2026-08-17
source: se-plan
artifacts:
  - plan.md
---

# Remove Workspace Tasks

Remove the bundled Workspace Tasks plugin from Forgerie. Remove its code, tests,
documentation, configuration examples, and active references. Preserve shared
terminal command support because other plugins still use it.

Migrate stored radial-menu state so the removed Tasks target releases only its
own slot. Keep every other learned direction unchanged.
