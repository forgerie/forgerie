import { useState } from "react";
import { WorkerModelPicker } from "./WorkerModelPicker";
import { WORKER_MODELS } from "./fixtures/sheet";
import { ModelPrefsContext } from "../models/modelPrefsApi";
import { chainPrefsSource } from "../models/fixtures/chainPrefs";

export const name = "Worker model picker";
export const note = "One worker's model in the composer's picker, with a way back to the model the route came with";

/** Real handlers on local state: a choice sticks, and the way back returns. */
function Picking({ initial, proposed }: { initial: string | undefined; proposed: string | undefined }) {
  const [model, setModel] = useState(initial);
  return <p>api runs on <WorkerModelPicker worker="api" model={model} models={WORKER_MODELS} reset={{ to: proposed, label: "Use the agent's" }} onChange={setModel} /></p>;
}
export default function Proposed() { return <Picking initial="anthropic/claude-sonnet-5" proposed="anthropic/claude-sonnet-5" />; }
export function Changed() { return <Picking initial="anthropic/claude-opus-4-5:high" proposed="anthropic/claude-sonnet-5" />; }
export function SessionModel() { return <Picking initial={undefined} proposed={undefined} />; }
/** The worker runs on a model chain at its own level; the picker offers the app's chains above the models. */
export function OnAChain() {
  return <ModelPrefsContext.Provider value={chainPrefsSource()}><Picking initial="worker:high" proposed="anthropic/claude-sonnet-5" /></ModelPrefsContext.Provider>;
}
