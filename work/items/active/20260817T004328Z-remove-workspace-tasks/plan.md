---
title: "refactor: Remove Workspace Tasks end to end"
type: refactor
status: completed
date: 2026-08-17
verify_command: "npm run verify"
---

# refactor: Remove Workspace Tasks end to end

## Summary

Remove the bundled Workspace Tasks plugin and every current user-facing reference to it. Add a narrow radial-slot migration for returning users, while keeping shared terminal command support and the general plugin system unchanged.

---

## Problem Frame

Workspace Tasks is a thin launcher for saved shell commands. It adds a panel, action, config format, tests, documentation, and persistent radial-menu state. The product no longer wants this feature, so leaving any of those surfaces would create dead configuration, stale guidance, or an empty radial direction.

---

## Requirements

- R1. The `workspace-tasks` plugin, Tasks workspace panel, and Open Workspace Tasks action no longer ship or appear at runtime.
- R2. `.forgerie/tasks.json` is no longer documented or treated as a supported Forgerie config format.
- R3. Stored radial maps remove only `workspace-tasks:workspace.tasks`; every other stored target keeps its slot.
- R4. The freed radial slot can accept the next available panel during normal reconciliation.
- R5. Shared terminal command-run APIs and all remaining plugins keep their current behavior.
- R6. Generic plugin discovery, build globs, and config parsing remain unchanged.
- R7. User documentation, config examples, active engineering references, and release notes match the removal.
- R8. The built manifest and all four Galaxy Z Fold 8 acceptance postures show no Workspace Tasks surface.
- R9. The local deployed instance serves the rebuilt output after the change.

---

## Scope Boundaries

- Do not remove `WorkspacePanelTerminal.runCommand`, terminal command-run records, routes, or services.
- Do not change the Updates, Processes, Relays, Info, or core panel behavior.
- Do not add a general migration framework for all removed plugin identifiers.
- Do not rewrite generic plugin discovery or build scripts; they already use directory scans and globs.
- Do not edit completed work-item plans that mention Workspace Tasks as historical context.
- Do not delete inert `plugins.workspace-tasks` keys from user-owned config files.

---

## Context & Research

### Relevant Code and Patterns

- `scripts/build-plugins.mjs` removes and rebuilds `dist/pi-web-plugins/` from the source directory. Deleting the plugin directory removes the built plugin without a registry edit.
- `src/server/piWebPluginService.ts` discovers bundled plugins from `dist/pi-web-plugins/`. It has no Workspace Tasks allowlist.
- `src/client/src/appShell/radialSlots.ts` owns the stored radial map and reads `forgerie.radialSlots.v1` before `PiWebApp` reconciles installed panels.
- `src/client/src/components/PiWebApp.ts` writes a reconciled map only when assignments change.
- `src/client/src/appShell/radialSlots.test.ts` already tests stored maps, reserved slots, and reconciliation through the public functions.
- `docs/plugins.md` with `docs/plugins.html`, and `docs/config.md` with `docs/config.html`, are paired but independently maintained.
- `pi-web-plugins/updates/pi-web-plugin.ts` still uses terminal command execution, so the shared API must remain.
- `AGENTS.local.md` requires a build and restart of both local systemd user units after user-facing changes on `main`.

### Institutional Learnings

- Radial assignments are stored to preserve muscle memory. A temporarily hidden panel keeps its slot, but a permanently removed plugin needs an explicit narrow migration.
- Bundled plugin checks use globs and directory scans. Source deletion automatically updates typechecking, linting, Knip, build output, and the plugin API boundary scan.
- Paired Markdown and HTML documentation has no automatic content-parity check. Both forms need direct review.
- Published user-visible changes require a Changeset because `dist` and the Markdown plugin/config docs ship in the npm package.

### External References

- None. The repository has direct and current patterns for every affected surface.

---

## Key Technical Decisions

- Migrate the removed target at the radial storage seam: this runs before `PiWebApp` caches the map and keeps migration logic beside storage parsing.
- Keep the `forgerie.radialSlots.v1` key: a key bump would reset every learned direction, which violates R3.
- Make the migration pure before the storage write: the removed target becomes an empty slot, while all other entries and slot indexes remain unchanged.
- Rewrite stored state only when the migration changed it: this makes the migration idempotent and avoids unrelated storage writes.
- Keep reserved-slot behavior for temporarily unavailable panels: only the exact removed Workspace Tasks qualified identifier is reclaimed.
- Replace test-only Workspace Tasks identifiers with surviving panel identifiers. Preserve tests for generic slot stability and overflow behavior.
- Keep a non-empty plugin `settings` object in `src/config.test.ts`: the config persistence test must retain nested pass-through coverage.
- Use a patch Changeset, as confirmed in scope. Do not edit `CHANGELOG.md` directly.

---

## Open Questions

### Resolved During Planning

- **How should existing radial state migrate?** Read the existing v1 map, remove only the Workspace Tasks target, persist the cleaned map, then use normal reconciliation.
- **Should shared command execution be removed?** No. Updates and the public plugin API still use it.
- **Should old user config keys be migrated?** No. Unknown plugin keys already remain valid and inert.
- **Should historical completed plans be rewritten?** No. Keep historical records intact; update only the active dangling exemplar.

### Deferred to Implementation

- The exact replacement panel identifiers in generic radial tests may follow the clearest surviving test vocabulary. They must preserve the same slot and overflow scenarios.
- The exact Changeset filename may follow the next available repository naming convention.

---

## Implementation Units

### U1. Reclaim the removed radial target without resetting the map

**Goal:** Remove the stored Workspace Tasks target before panel reconciliation, while preserving every other assignment.

**Requirements:** R3, R4, R5

**Dependencies:** None

**Files:**
- Modify: `src/client/src/appShell/radialSlots.ts`
- Modify: `src/client/src/appShell/radialSlots.test.ts`

**Approach:**
- Add one narrow migration for the exact qualified target `workspace-tasks:workspace.tasks` at the localStorage read boundary.
- Keep the v1 storage key and existing map shape.
- Return an empty slot for the removed target. Keep all other valid targets in their original indexes.
- Persist the cleaned map only when the removed target was present.
- Keep `reconcileRadialSlots` generic. It will assign the freed slot to the next available panel through existing behavior.
- Remove Tasks from the source comment that describes shipped panel order.
- Replace Tasks as generic test data with surviving panel identifiers. Keep the reserved-slot invariant for panels that can return.

**Patterns to follow:**
- Pure parsing and comparison helpers in `src/client/src/appShell/radialSlots.ts`.
- Per-file happy-dom storage setup and cleanup in `src/client/src/appShell/radialSlots.test.ts`.

**Test scenarios:**
- Happy path: v1 storage contains Tasks in one slot and other panel targets elsewhere; reading removes only Tasks and preserves every other index.
- Integration: after reading the migrated map, reconciliation assigns the freed slot to the next available panel and leaves existing assignments fixed.
- Edge case: storage has no Tasks target; reading returns the same map and does not perform a migration write.
- Edge case: storage contains Tasks more than once; reading removes every removed target without changing map length.
- Edge case: no stored map exists; reading still returns `DEFAULT_RADIAL_SLOTS`.
- Error path: unreadable storage still falls back to the shipped map.
- Regression: a surviving panel that is temporarily unavailable still keeps its reserved slot.
- Regression: overflow and fixed slot-count behavior remain unchanged with surviving panel identifiers.

**Verification:**
- Returning-user state releases only the removed Tasks slot.
- A second read is stable and produces the same cleaned map.
- Existing radial slot tests still prove muscle-memory preservation for surviving panels.

### U2. Delete the plugin and remove live code references

**Goal:** Stop building, testing, discovering, and presenting Workspace Tasks, without changing shared infrastructure.

**Requirements:** R1, R5, R6, R7

**Dependencies:** U1

**Files:**
- Delete: `pi-web-plugins/workspace-tasks/package.json`
- Delete: `pi-web-plugins/workspace-tasks/pi-web-plugin.ts`
- Delete: `pi-web-plugins/workspace-tasks/config.ts`
- Delete: `pi-web-plugins/workspace-tasks/config.test.ts`
- Delete: `pi-web-plugins/workspace-tasks/taskRunner.ts`
- Delete: `pi-web-plugins/workspace-tasks/taskRunner.test.ts`
- Delete: `pi-web-plugins/workspace-tasks/tasksPanelElement.ts`
- Delete: `pi-web-plugins/workspace-tasks/workspaceTasksClient.ts`
- Delete: `pi-web-plugins/workspace-tasks/workspaceTasksClient.test.ts`
- Modify: `src/config.test.ts`
- Modify: `pi-web-plugins/relays/relaysPanelElement.ts`
- Modify: `work/items/active/01KZMSMT9AH8A352RP58BY4H9C-delegated-agents-panel/plan.md`

**Approach:**
- Delete the self-contained plugin directory. Let existing globs and directory discovery remove it from builds and manifests.
- Replace the config persistence fixture with a surviving plugin id. Keep a non-empty nested settings object to preserve pass-through coverage.
- Rewrite the Relays context-guard comment so it explains its own invariant without naming removed code.
- Replace the active delegated-agents plan's dangling exemplar with a surviving explicit-state pattern or a self-contained rule.
- Do not edit plugin API types, terminal services, terminal routes, build scripts, Knip config, TypeScript config, or generic plugin tests.

**Patterns to follow:**
- Generic plugin config fixtures in `src/config.test.ts`.
- Self-contained invariant comments in `pi-web-plugins/relays/relaysPanelElement.ts`.
- Directory-driven plugin discovery in `scripts/build-plugins.mjs` and `src/server/piWebPluginService.ts`.

**Test scenarios:**
- Happy path: a surviving plugin id with a non-empty settings object saves and loads unchanged through Forgerie config persistence.
- Integration: plugin typechecking and the public API boundary scan succeed with the Workspace Tasks directory absent.
- Regression: terminal command-run types and the Updates plugin still compile and remain covered by their current tests.

**Verification:**
- No source or test imports depend on `pi-web-plugins/workspace-tasks/`.
- The bundled plugin build contains no `dist/pi-web-plugins/workspace-tasks/` directory.
- Remaining plugin and config tests pass without reducing nested settings coverage.

### U3. Remove supported-config guidance and publish the removal

**Goal:** Make every current user-facing document and release note match the new product surface.

**Requirements:** R2, R7

**Dependencies:** U2

**Files:**
- Modify: `docs/plugins.md`
- Modify: `docs/plugins.html`
- Modify: `docs/config.md`
- Modify: `docs/config.html`
- Create: `.changeset/remove-workspace-tasks.md`

**Approach:**
- Remove the complete Workspace Tasks section from both plugin documentation forms.
- Remove both HTML copy buttons with their linked code blocks, so no dead `data-copy` target remains.
- Replace general plugin configuration examples with surviving plugin ids where an example is still useful.
- Remove `.forgerie/tasks.json` from project-config guidance in both config documentation forms.
- Keep Markdown and HTML claims aligned by reviewing each pair side by side.
- Add a patch Changeset that tells users the built-in Tasks panel and config format were removed. State that existing radial assignments migrate automatically.
- Do not edit `README.md` or `CHANGELOG.md`.

**Patterns to follow:**
- Canonical plugin placement in `docs/plugins.md` and `docs/plugins.html`.
- Canonical config placement in `docs/config.md` and `docs/config.html`.
- User-facing Changeset style in `.changeset/` and `.agents/skills/changeset-changelog/SKILL.md`.

**Test scenarios:**
- Test expectation: none — this unit removes documentation and adds release metadata. Verification uses content review, build output, and repository checks.

**Verification:**
- Current product docs contain no Workspace Tasks section or `.forgerie/tasks.json` guidance.
- HTML copy controls have no removed target ids.
- Remaining configuration examples use real current plugins.
- The Changeset reports user impact without implementation-only detail.

### U4. Verify packaging, runtime absence, responsive surfaces, and deployment

**Goal:** Prove the removed plugin is absent from shipped output and from the running Forgerie UI.

**Requirements:** R1, R4, R5, R8, R9

**Dependencies:** U1, U2, U3

**Files:**
- Test: `src/client/src/appShell/radialSlots.test.ts`
- Test: `src/config.test.ts`
- Verify: `pi-web-plugins/pluginPublicApi.test.ts`
- Verify: `scripts/capture-postures.mjs`
- Verify: `scripts/capture-radial.mjs`
- Verify: `AGENTS.local.md`

**Approach:**
- Run the repository verification gate after the focused radial and config tests pass.
- Build from a clean `dist/` so stale bundled plugin files cannot survive.
- Check the local plugin manifest and built directories for absence of `workspace-tasks`.
- Capture and inspect the standard workspace surface at all four Galaxy Z Fold 8 CSS viewports. Confirm no Tasks panel appears and the remaining panel surface stays usable.
- Capture and inspect the open radial menu at all four postures. Confirm the removed target is absent and no unexplained permanent hole remains after migration and reconciliation.
- Restart both local systemd user units only when no agent run is active. Confirm the web service is healthy and the deployed manifest matches the build.

**Patterns to follow:**
- Galaxy Z Fold 8 posture matrix and image-review requirement in `AGENTS.md`.
- Existing radial gesture capture in `scripts/capture-radial.mjs`.
- Local deployment sequence and in-flight-session warning in `AGENTS.local.md`.

**Test scenarios:**
- Integration: the rebuilt `/pi-web-plugins/manifest.json` has no `workspace-tasks` entry.
- Integration: a browser with migrated Tasks slot data shows a surviving panel in the reclaimed direction.
- Happy path: a fresh browser shows the remaining workspace panels with no Tasks tab in all four postures.
- Regression: Updates can still start its terminal command through the unchanged shared API.
- Operational: after both services restart, the local HTTP health check succeeds and the browser loads the rebuilt client.

**Verification:**
- `npm run verify` passes.
- The clean production build passes and contains no Workspace Tasks artifact.
- All eight inspected captures show the expected remaining surfaces.
- The deployed manifest omits Workspace Tasks and the local Forgerie endpoint returns success.

---

## System-Wide Impact

- **Interaction graph:** Browser startup reads radial storage, migrates the removed target, loads the plugin manifest, reconciles available panels, and persists any newly assigned slot.
- **Error propagation:** Invalid radial storage keeps its current fallback behavior. Plugin removal introduces no new server or terminal errors.
- **State lifecycle risks:** The migration must run before `PiWebApp` caches radial assignments. It must not reset the storage key or move surviving targets.
- **API surface parity:** Plugin API command execution, terminal run records, server routes, and Updates behavior remain unchanged.
- **Integration coverage:** Unit tests prove migration and config persistence. Build and manifest checks prove packaging. Four-posture screenshots prove user-facing absence.
- **Unchanged invariants:** Temporarily unavailable panels keep reserved radial slots. Generic plugin ids in user config remain valid pass-through data.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A stale Tasks target remains cached for the browser session | Run the migration inside the radial storage read path, before `PiWebApp` field initialization. |
| The migration resets learned directions | Keep the v1 key and remove only the exact Tasks qualified id. Test index preservation. |
| A stale built plugin remains served | Use the clean production build, which removes `dist/` before rebuilding, then inspect the manifest and build tree. |
| Markdown and HTML docs diverge | Edit and review each canonical pair together. Remove linked HTML copy controls as one block. |
| Config test coverage weakens | Keep a surviving plugin fixture with a non-empty nested settings object. |
| Shared terminal support is removed by over-broad cleanup | Keep plugin API and terminal infrastructure out of scope. Verify the Updates plugin still compiles and runs its command path. |
| Local restart interrupts active agent work | Check for active runs before restarting both systemd user units. |
| Static screenshots miss the radial menu | Use the existing press-and-hold radial capture, then inspect every image. |

---

## Documentation / Operational Notes

- The removal needs a patch Changeset because the plugin ships in published `dist/` output and the Markdown docs ship in the npm package.
- Existing user config entries for `plugins.workspace-tasks` become inert. No file migration is required.
- Existing `.forgerie/tasks.json` files remain ordinary repository files. Forgerie will no longer read them.
- The local deployment must rebuild before restart because the systemd units serve `dist/`, not source.
- Restarting `forgerie-sessiond.service` stops in-flight agent runs. Schedule the restart when the system is idle.

---

## Sources & References

- Related code: `pi-web-plugins/workspace-tasks/`
- Plugin build: `scripts/build-plugins.mjs`
- Plugin discovery: `src/server/piWebPluginService.ts`
- Radial state: `src/client/src/appShell/radialSlots.ts`
- Radial integration: `src/client/src/components/PiWebApp.ts`
- Plugin docs: `docs/plugins.md`, `docs/plugins.html`
- Config docs: `docs/config.md`, `docs/config.html`
- Deployment rules: `AGENTS.local.md`
