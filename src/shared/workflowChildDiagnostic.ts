import type { WorkflowRun } from "./workflowRuns.js";
import { childModelDiagnostic } from "./childModelDiagnostic.js";

type ChildState = WorkflowRun["children"][number]["state"];
/** One projection for ordinary settlement, native-submission recovery, reporter faults and old record reads. */
export function workflowChildDiagnostic(state: ChildState): ChildState {
  return state.kind === "working" ? state : { ...state,
    result: state.outcome === "answered" ? state.result : childModelDiagnostic(state.result),
    ...(state.deliveryError === undefined ? {} : { deliveryError: childModelDiagnostic(state.deliveryError) }),
  };
}
