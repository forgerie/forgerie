# Testing and coverage

Forgerie uses Vitest for unit, component, route, and integration tests.

## Commands

- `npm run test:watch` keeps Vitest open and reruns tests related to saved files.
- `npm run test:related -- src/path/to/module.ts` runs tests that import the given file.
- `npm run test:changed` tests branch and worktree changes since the merge base with `main`.
- `npm run test:changed -- other-base` uses a different base branch or commit.
- `npm test` runs the complete test suite without coverage instrumentation.
- `npm run test:coverage` runs the complete suite and enforces the coverage thresholds in `vitest.config.ts`.
- `npm run verify:static` runs type checking, linting, and unused-code checks.
- `npm run verify` runs all static checks and the complete test suite.

Use watch mode for the shortest edit loop. Use the changed command before pushing a focused change. Run `npm run verify` before merging when CI is unavailable.

The coverage command writes these reports under `coverage/`:

- a console summary;
- an HTML report at `coverage/index.html`;
- `coverage/lcov.info` for editor and reporting tools;
- JSON reports for automated analysis.

CI runs the complete suite once on each operating system. Linux runs it with coverage. Windows runs it without coverage. Static checks run once on Linux. This removes duplicate test and static-check work.

## Affected-test selection

Vitest finds related tests through static imports. It cannot find every dependency that tests read through the filesystem or a subprocess.

The repository selection policy is in `scripts/test-selection.mjs`. It adds tests for known runtime dependencies. These dependencies include Docker assets, documentation assets, client build inputs, installer files, plugin files, and speech worker files.

The selection policy runs the complete suite for broad changes. Broad changes include package manifests, TypeScript configurations, Vitest configuration, bundled dependencies, and deleted source files. A deleted source file removes import-graph evidence, so a related run cannot be trusted.

The changed command selects committed, staged, unstaged, and untracked paths. It tests the current worktree content. Use CI to validate the committed branch without local edits.

The pre-commit hook uses the same selection policy for staged files. A clean worktree runs in place. A dirty worktree uses a temporary Git-index snapshot. The snapshot reuses the installed `node_modules` directory. Selective runs are a fast feedback tool. The complete CI suite remains the merge gate.

## Runner performance policy

The normal suite uses Vitest's default child processes and worker count. A 16-core benchmark found no faster stable fixed worker limit. Worker threads were slightly faster, but they share process state and broke isolation-sensitive tests.

Coverage stays at four workers. This limit is slower than the normal suite, but it avoids coverage teardown failures.

Do not disable test-file isolation for speed. Many tests change globals, environment variables, browser state, or process state.

## Measured scope

Coverage measures product code under `src/` and bundled plugin code under `pi-web-plugins/`.

The report excludes:

- test files and test-support modules;
- type declaration files;
- engineering scripts under `scripts/`;
- the browser, web server, session daemon, and CLI process entrypoints;
- the CLI-only version-report module.

Vitest's V8 provider measures code in its test workers. It does not merge code executed by child processes. The excluded process entrypoints and engineering scripts use subprocess, package, smoke, and contract tests instead. Excluding them prevents tested subprocess behavior from appearing as false zero coverage.

## Coverage policy

Coverage thresholds are a ratchet. A change must not reduce the established statement, branch, function, or line baseline.

Raise a threshold when sustained test improvements move the baseline above it. Do not lower a threshold to make a change pass without documenting the reason.

Prefer tests that prove observable behavior through public contracts:

1. pure state and conversion logic;
2. controllers and services;
3. routes and protocol mapping;
4. component rendering and user interaction;
5. filesystem, process, and local-server integration.

Do not add assertions only to execute a line. Do not couple tests to private implementation shape when a public contract can prove the same behavior.

Treat uncovered code as a review queue, not an automatic defect list. Prioritize security policy, durable state, lifecycle transitions, error handling, and user-visible behavior. Stop when the remaining gap is platform glue, visual geometry, defensive code that cannot occur through the public contract, or behavior already verified through a separate process boundary.
