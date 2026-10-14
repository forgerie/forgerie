import { TriggerAttention } from "./TriggerAttention";
import { audit, everywhere, nightly } from "./fixtures/triggers";
import { clock, projectLabel } from "./fixtures/scenario";

export const name = "Trigger attention";
export const note = "The newest failed or missed run since the trigger last needed a look, with Mark as seen and Run now";
export const composition = { default: [{ part: "src/ui/AlertCard.molecule.part.tsx", state: "CutError" }] };

export default function Failed() {
  return <TriggerAttention trigger={nightly} clock={clock} projectName={projectLabel} errorLines={4} onAcknowledge={() => undefined} onRunNow={() => undefined} onOpenSession={() => undefined} />;
}
export function FailedShortPage() {
  return <TriggerAttention trigger={nightly} clock={clock} projectName={projectLabel} errorLines={2} onAcknowledge={() => undefined} onRunNow={() => undefined} onOpenSession={() => undefined} />;
}
export function Missed() {
  return <TriggerAttention trigger={audit} clock={clock} projectName={projectLabel} errorLines={4} onAcknowledge={() => undefined} onRunNow={() => undefined} onOpenSession={() => undefined} />;
}
export function FailedInOneProject() {
  return <TriggerAttention trigger={everywhere} clock={clock} projectName={projectLabel} errorLines={4} onAcknowledge={() => undefined} onRunNow={() => undefined} onOpenSession={() => undefined} />;
}
