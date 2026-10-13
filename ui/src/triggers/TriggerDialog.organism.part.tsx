import { useState } from "react";
import type { Trigger } from "@shared/triggers";
import { TriggerDialog, type TriggerQuestion } from "./TriggerDialog";
import { docs, nightly } from "./fixtures/triggers";
import { clock, projectLabel } from "./fixtures/scenario";

export const name = "Trigger dialog";
export const note = "Run now, Delete, and leaving with unsaved changes ask first";

function Asking({ question }: { question: TriggerQuestion }) {
  const [answer, setAnswer] = useState("No answer yet");
  return <><p>{answer}</p>
    <TriggerDialog question={question} clock={clock} projectLabel={projectLabel} onConfirm={() => setAnswer("Confirmed")} onCancel={() => setAnswer("Cancelled")} /></>;
}
const run = (trigger: Trigger, error?: string): TriggerQuestion => ({ kind: "run", trigger, busy: false, error });
export default function RunNow() { return <Asking question={run(nightly)} />; }
export function RunNowPaused() { return <Asking question={run(docs)} />; }
export function RunNowRetry() { return <Asking question={run(nightly, "Failed to fetch. Press Run now to send the same request again; it starts at most one run.")} />; }
export function Delete() { return <Asking question={{ kind: "delete", trigger: nightly, busy: false }} />; }
export function Leave() { return <Asking question={{ kind: "leave", name: "Nightly refinement" }} />; }
