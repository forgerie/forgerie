import { useState } from "react";
import { TriggerList } from "./TriggerList";
import type { TriggerListLoad } from "./triggersModel";
import { calmList, emptyList, manyList, mixedList } from "./fixtures/triggers";
import { clock, projectLabel, rowActions } from "./fixtures/scenario";

export const name = "Trigger list";
export const note = "Every trigger, grouped so a problem comes first; empty, loading, off, and failed reads";
export const composition = {
  default: [{ part: "src/triggers/TriggerRow.organism.part.tsx", state: "default" }, { part: "src/ui/RecordGroup.molecule.part.tsx", state: "default" }],
  Empty: [{ part: "src/ui/EmptyState.molecule.part.tsx", state: "default" }],
  Loading: [{ part: "src/ui/LoadingLines.atom.part.tsx", state: "default" }],
};

function List({ load, failure }: { load: TriggerListLoad; failure?: string }) {
  const [shown, setShown] = useState(failure);
  return <TriggerList load={load} clock={clock} projectLabel={projectLabel} starting={new Set()} failure={shown} onDismissFailure={() => setShown(undefined)}
    onRefresh={() => undefined} onNew={() => undefined} onClose={() => undefined} actions={rowActions} />;
}

export default function Mixed() { return <List load={{ type: "ready", value: mixedList }} />; }
export function Calm() { return <List load={{ type: "ready", value: calmList }} />; }
export function Empty() { return <List load={{ type: "ready", value: emptyList }} />; }
export function Loading() { return <List load={{ type: "loading" }} />; }
export function StoreOff() { return <List load={{ type: "off", message: "Could not open the trigger store: database is locked" }} />; }
export function ReadFailed() { return <List load={{ type: "failed", message: "Request failed: HTTP 500", last: calmList }} />; }
export function Many() { return <List load={{ type: "ready", value: manyList }} />; }
export function CommandFailed() {
  return <List load={{ type: "ready", value: calmList }} failure="Could not pause “Weekday triage”: Another change came first. Read the trigger again." />;
}
