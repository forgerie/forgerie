---
name: testing-guide
description: "Repository testing guidance for server contracts, Vitest coverage, React component tests, test helpers, and failure triage. Load for test planning, writing, fixing, or review."
---

# Testing guide

Test the behavior that Forgerie ships. Use `code-quality-architecture` for production seams and [docs/testing.md](../../../docs/testing.md) for commands, coverage policy, and browser capture rules.

## Choose the smallest useful test

1. Use pure helper tests for shaping, validation, and command construction.
2. Use service tests for state, ordering, cancellation, and persistence.
3. Use route tests for HTTP status, payload validation, aliases, and removed endpoints.
4. Use React component tests for rendered state and user interaction.
5. Use real browser captures for layout. happy-dom cannot prove clipping, scroll geometry, or adaptation.

A test must assert returned values, durable state, emitted events, HTTP responses, or user-visible behavior. Avoid private implementation shape and branches that do not express a contract.

## Boundaries and fixtures

- Prefer real temporary files, repositories, in-process HTTP servers, and controlled subprocesses where practical.
- Keep global stubs, timers, and pending promises scoped to a test. Restore them in teardown.
- Use the existing typed runtime and gateway helpers for agent orchestration. Inject only the boundary that the scenario needs.
- Keep fixtures explicit. Add a shared helper only when multiple tests need it.
- Use behavior names for configurable implementations. Do not add `Mock*`, `Stub*`, or `Fake*` classes.
- Dispose services and close servers in `finally`, including when an assertion fails.
- Keep test-file isolation. SDK and profile tests change process environment and module state.
- Use temporary profiles. A test must not load live credentials, mutate deployed dependencies, or start or stop existing service units.

## Browser component tests

The React app has its own dependencies, tests, and gates under `ui/`. Follow nearby tests and their happy-dom setup. Use accessible labels and real DOM events for event wiring, keyboard behavior, focus, drafts, and control state. Settle React updates before assertions and unmount roots during teardown.

Use fixture APIs and the same production component in tests and previews. Do not copy its renderer, intercept requests, or replace global fetch to make a preview work. A binding owns data access; its component receives fixture data through that same boundary.

For a component's CSS or layout, follow `frontend-design`, `intrinsic-design`, and `caliper-render`. Read every capture. State which components, states, and emulated viewports you checked. A captured PNG is not physical-device acceptance.

## Verification and failures

Run the focused changed tests first, then typecheck and lint. Cross-cutting changes require `npm run verify`. Deleted modules require the full suite because their import graph is gone. Preserve coverage thresholds.

Inspect the complete failure before changing code or tests. A timeout under concurrent builds is not proof of a product regression. Rerun heavy checks serially before changing deadlines. Do not remove an assertion or lower a gate to make a test pass.

Record exact commands and results. Installed-package checks must describe what they actually exercise; checking bundled source or a package manifest does not prove a delegated agent ran.
