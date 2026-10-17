/**
 * Test files that time out when they share the CPU with the rest of the suite, and pass when they run alone.
 * They run in a second, serial lane after the parallel lane finishes: in `npm test`, the coverage run and the
 * pre-commit hook's related tests. Remove a file once it passes reliably in the parallel lane.
 * See docs/testing.md#serial-lane.
 */
export const SERIAL_LANE = [
  "src/server/sessions/durableChildAgents.test.ts",
  "src/server/sessions/durableChildAutonomy.test.ts",
  "src/server/sessions/durableRiskLabels.test.ts",
  "src/server/sessions/parentAnswers.test.ts",
  "src/server/sessions/workflowRuns.test.ts",
  "src/server/sessions/globalProviderPolicy.acceptance.test.ts",
  "src/server/sessions/sessionRpc.test.ts",
  "src/server/workspaces/workspaceServicesLauncher.test.ts",
  "src/server/triggers/triggerRoutes.test.ts",
  "src/server/speech/speechService.test.ts",
];
