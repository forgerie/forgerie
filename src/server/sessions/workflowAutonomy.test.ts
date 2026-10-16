import { expect, it } from "vitest";
import { readWorkflowAutonomy, WAIT_FOR_USER } from "./workflowAutonomy.js";

it("lands automatically and allows two review rounds by default, and waits for the user when the plugin is off", () => {
  expect(readWorkflowAutonomy({})).toEqual({ landStops: true, approveStops: false, reviewRounds: 2 });
  expect(readWorkflowAutonomy({ plugins: { "workflow-autonomy": { enabled: false } } })).toEqual(WAIT_FOR_USER);
  expect(readWorkflowAutonomy({ plugins: { "workflow-autonomy": { settings: { approve_stops: true, land_stops: false, review_rounds: "unlimited" } } } }))
    .toEqual({ landStops: false, approveStops: true, reviewRounds: undefined });
  // An invalid stored value falls back to the default.
  expect(readWorkflowAutonomy({ plugins: { "workflow-autonomy": { settings: { review_rounds: "9" } } } }).reviewRounds).toBe(2);
});
