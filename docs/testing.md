# Testing and coverage

Forgerie uses Vitest for contracts, services, routes, components, and integration tests. Run development and verification on Node 24.

## Commands

| Command | Scope |
| --- | --- |
| `npm test` | Complete server and shared-code suite. |
| `npm run test:watch` | Server tests on saved changes. |
| `npm run test:related -- src/path/to/module.ts` | Tests related through imports. |
| `npm run test:changed` | Current branch and worktree changes since the merge base with `main`. |
| `npm run test:coverage` | Server suite with coverage thresholds and four workers. |
| `npm run verify:static` | Server typecheck, ESLint, server Knip, and browser-app Knip. |
| `npm run verify:ui` | Browser build, lint, tests, and decomposition gates. |
| `npm run verify` | Both applications' static and test verification. |
| `npm run build` | Clean compiled server output and browser build. |
| `npm run smoke:package-install` | Isolated installed-package managed-process and subagent smoke tests. |

GitHub CI runs on Linux. It uses `npm run test:coverage -- --no-file-parallelism` to prevent compiler-graph and SDK acceptance tests from competing for CPU. Every test, deadline, isolation boundary, and coverage threshold stays enabled. The cost is a longer coverage run. Local `npm run test:coverage` still permits four workers.

The package-install smoke test also passes the real tarball's manifest to npm's own platform validator with `os: "win32"`. npm's CLI `--os` override only affects optional dependencies. This verifies the package restriction, not execution on Windows. Native Windows server support is retired. Browser access from Windows is unchanged.

Use focused tests while editing. Run `npm run verify` before merging cross-cutting changes. Build and install only in an isolated worktree when active agents use the deployed checkout. Do not restart live services to run tests.

## Browser verification

The browser suite uses happy-dom for DOM behavior. It does not prove layout, clipping, scroll geometry, or real device behavior.

Use the UI's production components and fixture APIs for previews. Do not intercept network requests or replace a production renderer with a copied mockup. `ui/gates/` checks component ownership, parts, tokens, and decomposition. Remove a pending entry when its offence disappears; never add an entry to hide a new offence. See [UI decomposition](../ui/docs/decomposition.md).

For posture captures, start an isolated browser-app dev server. Use the repository's CDP posture runner, not Chromium window sizing:

```bash
node scripts/capture-postures.mjs --url http://127.0.0.1:8505/ \
  --out /tmp/forgerie-shots --label change --color-scheme dark
```

Repeat in light mode and read every PNG. The four Fold 8 CSS viewports are `704 × 783`, `932 × 553`, `475 × 638`, and `711 × 374`. Captures prove emulated geometry, not physical-device acceptance. Use Caliper parts and their checks when the changed component has a part. Record missing parts and remaining findings rather than claiming a pass.

## Affected tests

`scripts/test-selection.mjs` adds tests for speech-worker files read at runtime. Package manifests, TypeScript or Vitest configuration, bundled dependencies, and deleted source files trigger the full suite. Deletion removes import-graph evidence, so related tests alone are not sufficient.

`test:changed` selects committed, staged, unstaged, and untracked paths, then tests current worktree content. The pre-commit hook uses the same policy for staged source. A dirty worktree uses a temporary Git-index snapshot with the installed server dependencies. The complete verification remains the merge gate, including the separate browser app.

## Coverage and isolation

Server coverage measures product code under `src/`. It excludes test support, declarations, engineering scripts, process entrypoints, and the CLI-only version report. Browser coverage and tests belong to `ui/`, not the server's Knip or Vitest graph.

Coverage writes HTML, LCOV, and JSON under `coverage/`. Thresholds are a ratchet; do not lower them to make cleanup pass. Prefer tests of externally visible behavior, validation, durable state, lifecycle ordering, and failure handling.

Keep test-file isolation. Tests change environment variables, globals, filesystem state, and process state. Real temporary repositories, in-process servers, and controlled subprocesses verify these contracts without touching live profiles or service units.
