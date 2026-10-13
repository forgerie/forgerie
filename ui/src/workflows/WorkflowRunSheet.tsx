import { Lede } from "../ui/Lede";
import { MarkdownFragment } from "../ui/MarkdownFragment";
import { RouteMap } from "../ui/RouteMap";
import { SheetDialog } from "../ui/SheetDialog";
import { useNow } from "../ui/useNow";
import { nextRetry } from "../childAgents/childAgentsModel";
import { routeSteps, runStatus, type ChildLook, type WorkflowRun } from "./workflowsModel";

/**
 * Shape: one workflow run as its live route. Each started worker opens its
 * child. Decisions stay in the thread, where the stop cards are; this sheet
 * only shows where the run stands. A worker that waits to retry a model error
 * counts down to its next try.
 */
export function WorkflowRunSheet({ run, workers, onOpenChild, onClose, now: clock = Date.now }: {
  run: WorkflowRun;
  /** What the session knows about the run's children: their agents, branches, and questions. */
  workers: readonly ChildLook[];
  onOpenChild: (name: string) => void;
  onClose: () => void;
  /** The clock a retry counts down on. */
  now?: () => number;
}) {
  const now = useNow(clock, nextRetry(workers));
  const stages = run.stages ?? [];
  return <SheetDialog title={run.definition.name} subtitle={runStatus(run)} closeLabel="Close the run" onClose={onClose}>
    {run.state.kind === "finished" ? <MarkdownFragment text={run.state.result} />
      : stages.length === 0 ? <Lede>This workflow declares no stages. The agent follows its prose; its children are in the child agents panel.</Lede> : null}
    {stages.length > 0 && <RouteMap label={`${run.definition.name} route`} steps={routeSteps(stages, run, workers, onOpenChild, now)} />}
  </SheetDialog>;
}
