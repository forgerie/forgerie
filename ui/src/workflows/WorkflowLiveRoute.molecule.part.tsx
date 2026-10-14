import { useState } from "react";
import { WorkflowLiveRoute } from "./WorkflowLiveRoute";
import { liveRoute, proseWorkers } from "./workflowLive";
import { LOOKS, MODELS, PROSE_RUN, RUN_FINISHED, RUN_WORKING, SHEET_NOW } from "./fixtures/sheet";

export const name = "Workflow live route";
export const note = "A running route: where each stage stands, one block per worker run, and each worker's model; a worker opens its record";

/** Real handlers: a worker opens. */
function Live({ run = RUN_WORKING, prose = false }: { run?: typeof RUN_WORKING; prose?: boolean }) {
  const [selected, setSelected] = useState<string>();
  return <WorkflowLiveRoute stages={liveRoute(run, LOOKS, SHEET_NOW)} prose={prose ? proseWorkers(run, LOOKS, SHEET_NOW) : undefined} selected={selected} known={MODELS}
    onStage={() => {}} onWorker={setSelected} />;
}
export default function Working() { return <Live />; }
export function Finished() { return <Live run={RUN_FINISHED} />; }
export function ProseOnly() { return <Live run={PROSE_RUN} prose />; }
