# Testing and coverage

Forgerie uses Vitest for unit, component, route, and integration tests.

## Commands

- `npm test` runs the complete test suite without coverage instrumentation.
- `npm run test:coverage` runs the complete suite and enforces the coverage thresholds in `vitest.config.ts`.
- `npm run verify` runs type checking, linting, unused-code checks, and the normal test suite.

The coverage command writes these reports under `coverage/`:

- a console summary;
- an HTML report at `coverage/index.html`;
- `coverage/lcov.info` for editor and reporting tools;
- JSON reports for automated analysis.

CI runs coverage on Linux and uploads the report as a short-lived workflow artifact. The normal suite still runs on Linux and Windows.

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
