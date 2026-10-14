import { useState } from "react";
import type { Trigger } from "@shared/triggers";
import { TriggerDialog, type RunScope, type TriggerQuestion } from "./TriggerDialog";
import { docs, everywhere, nightly, PI_MONO, projects, spreadNotes } from "./fixtures/triggers";
import { clock, projectLabel } from "./fixtures/scenario";

export const name = "Trigger dialog";
export const note = "Run now (in every target project or one), Delete, and leaving with unsaved changes ask first";
export const composition = { Several: [{ part: "src/ui/ToggleGroup.molecule.part.tsx", state: "FormField" }] };

/** Real handlers on local state: the answer shows above, and Run now's choice of projects changes the question. */
function Asking({ question: first }: { question: TriggerQuestion }) {
  const [answer, setAnswer] = useState("No answer yet");
  const [question, setQuestion] = useState(first);
  return <><p>{answer}</p>
    <TriggerDialog question={question} clock={clock} projectLabel={projectLabel} onConfirm={() => setAnswer("Confirmed")} onCancel={() => setAnswer("Cancelled")}
      onScope={(scope) => setQuestion((current) => current.kind === "run" && !current.sent ? { ...current, scope } : current)} /></>;
}
const run = (trigger: Trigger, error?: string, scope: RunScope = { kind: "all" }, sent = false): TriggerQuestion => ({ kind: "run", trigger, busy: false, error, scope, sent,
  choices: trigger.action.targets.kind === "all" ? projects.map((project) => project.path) : trigger.action.targets.cwds });
export default function RunNow() { return <Asking question={run(nightly)} />; }
export function RunNowPaused() { return <Asking question={run(docs)} />; }
export function RunNowRetry() { return <Asking question={run(nightly, "Failed to fetch. Press Run now to send the same request again; it starts at most one run.", { kind: "all" }, true)} />; }
export function Several() { return <Asking question={run(spreadNotes)} />; }
export function SeveralOneProject() { return <Asking question={run(spreadNotes, undefined, { kind: "one", cwd: PI_MONO })} />; }
export function SeveralChoosing() { return <Asking question={run(spreadNotes, undefined, { kind: "one" })} />; }
export function AllProjects() { return <Asking question={run(everywhere)} />; }
export function SeveralRetry() {
  return <Asking question={run(spreadNotes, "Failed to fetch. Press Run now to send the same request again; it starts at most one run.", { kind: "one", cwd: PI_MONO }, true)} />;
}
export function Delete() { return <Asking question={{ kind: "delete", trigger: nightly, busy: false }} />; }
export function Leave() { return <Asking question={{ kind: "leave", name: "Nightly refinement" }} />; }
