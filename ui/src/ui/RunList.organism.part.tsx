import { RunList } from "./RunList";
import { RunRow } from "./RunRow";

export const name = "Run list";
export const note = "A titled list of builds: skeleton rows first, one alert with retry, an empty text, and a foot";
export const composition = {
  default: [{ part: "src/ui/RunRow.molecule.part.tsx", state: "Running" }],
};

const row = (id: number, state: "passed" | "failed" | "running", title: string) => ({ key: String(id), node: <RunRow state={state}
  stateText={state === "passed" ? "Success" : state === "failed" ? "Failure" : "In progress"} name="CI" title={title} age="2h"
  facts={[{ text: `#${String(id)}`, label: "Run ID", code: true }, { text: "main", label: "Branch", code: true }]} open={{ label: `Open run ${String(id)}`, onPress: () => {} }} /> });

export default function Rows() {
  return <RunList title="Linked runs" count="3 linked" rows={[row(1, "failed", "Retry dropped upload chunks"), row(2, "running", "Bump vite"), row(3, "passed", "Nightly")]}
    foot={<p>Foot: the field that adds one.</p>} />;
}
export function Loading() { return <RunList title="Linked runs" rows={[]} loading foot={<p>Foot: the field that adds one.</p>} />; }
export function Busy() { return <RunList title="Linked runs" count="1 linked" busy rows={[row(1, "failed", "Retry dropped upload chunks")]} />; }
export function Empty() {
  return <RunList title="Linked runs" rows={[]} empty={<p><strong>No linked runs</strong>Link a workflow run to follow it here.</p>} foot={<p>Foot: the field that adds one.</p>} />;
}
export function Failed() {
  return <RunList title="Linked runs" rows={[]} alert={{ text: <p>Forgerie could not read the runs. GitHub did not answer within 45 seconds.</p>, action: { label: "Try again", onPress: () => {} } }} />;
}
