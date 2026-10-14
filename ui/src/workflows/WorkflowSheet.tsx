import type { ComponentProps } from "react";
import { WorkflowRunView } from "./WorkflowRunView";
import { WorkflowStartView } from "./WorkflowStartView";

/** A saved workflow or a proposal before it starts (`source` says which), or a run. */
export type WorkflowSheetProps =
  | ({ mode: "start" } & ComponentProps<typeof WorkflowStartView>)
  | ({ mode: "run" } & ComponentProps<typeof WorkflowRunView>);

/**
 * Shape: one sheet for a workflow, in three modes on one shell: a saved workflow before it starts, a workflow the
 * agent proposed, and a run. Each puts the plan in the page you read and the route in the rail beside it, with the
 * actions under the rail.
 */
export function WorkflowSheet(props: WorkflowSheetProps) {
  // The mode only picks the view; each view ignores the extra prop.
  return props.mode === "run" ? <WorkflowRunView {...props} /> : <WorkflowStartView {...props} />;
}
