# Plugin settings

## Scope and design

Settings gains Plugins next to Agents. One page lists Pi packages, loose Pi extensions, Forgerie browser plugins, and read-only built-in add-ons. Each row opens a detail page. The header keeps Add package and Restart services reachable. Back, reload, fold, and rotation retain the selected page in the URL.

Keep the current Settings design. Use `SettingsFrame`, the Agents row structure, and the existing property rows. Extract the row, toggle, and confirmation dialog into shared UI rather than copy their behavior. Public Sans carries labels and explanations. JetBrains Mono carries source paths and JSON. Use the existing background, foreground, muted-foreground, line, primary, and destructive tokens in both themes. Do not introduce a new palette or viewport breakpoint.

```
Settings | Plugins                       Add package
  Restart needed                    Restart services
  Pi packages
    npm:@narumitw/pi-goal                     On >
  Pi extensions
    startup-context.ts                       On >
  Forgerie plugins
    cliproxyapi-quota                         On >
  Built in
    pi-subagents                        Read only >
```

Rows wrap source paths while the action keeps its width. Detail properties use the existing flex-wrap rules. Collections scroll within `SettingsFrame`; actions remain in the header or restart notice. The same structure holds at all four Fold viewports. No layout decision depends on a device name.

## Data and safety

Both Agents and Plugins ask `/api/pi-web/runtime` for sessiond's active profile. The config file alone can name a future profile that sessiond has not loaded. There is no fallback to terminal Pi, even if `PI_CODING_AGENT_DIR` points there. If sessiond is unavailable, editing fails with a retry action.

The dev/preview server serves `/aui/plugins`, like `/aui/agents`. Pi's own resolver discovers loose extensions without loading their code or installing missing packages. The existing gateway serves installs, browser-plugin discovery, and config writes.

Disable keeps the exact package entry in `forgerieDisabledPackages` in the same settings file. Enable restores resource filters as well as the source. Remove unregisters a package; it does not delete local code or uninstall code a live session can still use. Extension toggles use Pi's exact `+path` and `-path` overrides. Existing wildcard rules survive.

Changes use a revision of the profile, Pi settings, and Forgerie config. Each write checks that revision before changing settings. Pi writes use Pi's file lock and an atomic rename. Forgerie writes preserve other plugin entries and config fields through the existing config API.

Forgerie plugin settings use a JSON object editor. It works without executing a plugin's browser code to obtain its schema. The cost is that defaults and plugin-specific field descriptions are not shown. These plugins still render in the original client; this work does not port their contributions into the new client.

Plugin settings can contain secrets. Keep unsaved settings in memory, not browser storage. Restart requires a confirmation that names the loss of active runs. The endpoint restarts only the two fixed local Forgerie user units. Restart success requires both units to be active; the page does not report success from a queued command alone.

## Verification

Verified on 2026-10-07 in `new-ui-mvp`:

| Check | Evidence |
|---|---|
| Build, TypeScript, lint, and tests | `nix shell nixpkgs#nodejs_24 -c npm run verify` passed 87 test files and 830 tests. |
| Active profile | Live `/aui/agents` and `/aui/plugins` match sessiond's `/api/pi-web/runtime` profile, `/home/simonwjackson/.local/share/forgerie/agent`. |
| Settings HTTP contract | A real Vite server writes an Agent into that runtime profile, even when config names another profile. Plugin requests reject cross-origin writes, unconfirmed restart, stale revisions, invalid JSON objects, and bodies over 100 KB. |
| Pi mutations | Real temporary profiles and Pi's resolver test install, filtered-package disable/restore, extension overrides, and unregistering without deleting code. Throwing extensions prove discovery does not execute them. |
| Browser acceptance | `nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node scripts/plugins-acceptance.mjs` passed against the branch's live dev server on port 8510. |
| Visual acceptance | The run writes 58 PNGs to `verification/local/plugins/`. Settings, Agents, the Plugins list, a package detail, the quota detail, and the fixture's pending-restart list cover all four Fold CSS viewports in both themes. The header menu and the restart confirmation also cover both folded shapes in both themes. The install form covers both folded shapes in dark. Reviewed captures show real package names, paths written from `~`, the menu and window fully inside the screen, and no clipped labels. |
| State and safety | The browser run finds all four plugin groups, checks horizontal overflow, opens and closes the header menu, carries an unsaved JSON draft through every posture transition, and cancels restart confirmation. Real settings hashes remain unchanged. |

The live catalog contains 9 Pi packages, 6 loose extensions, 5 Forgerie browser plugins, and 4 read-only built-ins. `verification/local/plugins/report.json` records the URL, counts, per-posture checks, and unchanged files. The three checked files are Forgerie's Pi settings, Forgerie's config, and terminal Pi's settings.

Restarted only `forgerie-new-ui-dev.service` to load the new Vite middleware on port 8510. The temporary server on port 8512 was stopped. Both production services remained active. No real plugin was changed or installed. No production service restart was exercised; its confirmation, cancellation, and readiness behavior were tested through configurable service implementations.

### Remaining limits

These captures emulate the measured Fold viewports through CDP. They are not a hands-on physical-device check. Tab Ultra 11's CSS viewports remain unmeasured.

Forgerie config writes use the existing gateway API, which has no conditional-write token. Another client can still race between the final file check and the PUT. The new revision check rejects stale pages but does not remove that existing API limitation.

The main checkout's `AGENTS.md` still claims global Pi-profile reuse. Its machine-local `AGENTS.local.md` and the live runtime name the separate Forgerie profile. This change does not edit those instruction files. One configured package still reads code from `/home/simonwjackson/.pi/packages/pi-bedrock-principals`; profile isolation does not copy that external code.

The dependency audit reports the existing high-severity `source-map-js@1.2.1` advisory `GHSA-68fv-2mgg-jv7q`. This change leaves it unchanged.
