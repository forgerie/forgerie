import { useState } from "react";
import { RouteList, type RouteListStep } from "./RouteList";
import { TextButton } from "./TextButton";

export const name = "Route list";
export const note = "A process as a flat numbered list: steps, the items that work in them with their blocks, and the reader's own steps";

const PLANNED: RouteListStep[] = [
  { key: "shape", number: 1, name: "Shape", detail: "You approve", stopTone: "faint", stopLabel: "You approve" },
  { key: "port", number: 2, name: "Port the API and the page", items: [
    { key: "api", name: "api", kind: "full-stack-engineer", tones: ["faint"], control: <TextButton label="Claude Sonnet 5" onPress={() => {}} /> },
    { key: "page", name: "page", kind: "design-engineer", tones: ["faint"], control: <TextButton label="Session's model" onPress={() => {}} /> },
  ] },
  { key: "review", number: 3, name: "Review", items: [{ key: "review", name: "review", kind: "reviewer", tones: ["faint"] }] },
  { key: "land", number: 4, name: "Land", detail: "You land the branches", stopTone: "faint", stopLabel: "You land" },
];

/** Real handlers: a step marks itself as the one in view. */
export default function Planned() {
  const [here, setHere] = useState<string>();
  return <RouteList label="Route" action={{ label: "Edit stages", onPress: () => {} }}
    steps={PLANNED.map((step) => ({ ...step, here: step.key === here, onPress: () => setHere(step.key) }))} />;
}

/** Real handlers: a worker opens, and a folded step opens its workers. */
export function Live() {
  const [open, setOpen] = useState<string>("api");
  const [unfolded, setUnfolded] = useState(false);
  return <RouteList label="Route" meta="1 of 4 done" steps={[
    { key: "shape", name: "Shape", state: "done", detail: "Approved by you", stopTone: "plain", stopLabel: "Approved" },
    { key: "port", number: 2, name: "Port the API and the page", state: "current", items: [
      { key: "api", name: "api", kind: "full-stack-engineer", tones: ["live"], lines: [{ key: "s", text: "Working" }, { key: "m", text: "Claude Sonnet 5" }],
        selected: open === "api", onPress: () => setOpen("api") },
      { key: "page", name: "page", kind: "design-engineer", tones: ["plain", "warn"], lines: [{ key: "s", text: "Done, 2 runs" },
        { key: "r", text: "Report not delivered: Completion reporter faulted: Disk full", tone: "bad" }], selected: open === "page", onPress: () => setOpen("page") },
    ] },
    { key: "review", number: 3, name: "Review", state: "next", expanded: unfolded, onPress: () => setUnfolded(!unfolded), folded: unfolded ? undefined : ["faint"],
      items: unfolded ? [{ key: "review", name: "review", kind: "reviewer", tones: ["faint"], lines: [{ key: "s", text: "Not started" }] }] : [] },
    { key: "land", number: 4, name: "Land", state: "waiting", detail: "Waiting for you to land", detailTone: "live", stopTone: "needs", stopLabel: "Waits for you" },
  ]} />;
}

/** Real handlers: remove steps and items, and add a step between two. */
export function Editing() {
  const [steps, setSteps] = useState(PLANNED);
  return <RouteList label="Route" action={{ label: "Done", pressed: true, onPress: () => {} }}
    gap={(after) => after === "land" ? null : <TextButton label="Add a stage here" onPress={() => setSteps((current) => {
      const at = after === undefined ? 0 : current.findIndex((step) => step.key === after) + 1;
      return [...current.slice(0, at), { key: `new-${String(current.length)}`, name: "Docs", added: true }, ...current.slice(at)].map((step, index) => ({ ...step, number: index + 1 }));
    })} />}
    steps={steps.map((step) => ({ ...step, remove: { label: `Remove stage ${String(step.name)}`, onPress: () => setSteps((current) => current.filter((s) => s.key !== step.key)) },
      items: step.items?.map((item) => ({ ...item, remove: { label: `Remove worker ${item.name}`, onPress: () => setSteps((current) => current.map((s) => s.key === step.key
        ? { ...s, items: s.items?.filter((i) => i.key !== item.key) } : s)) } })) }))} />;
}

/** No steps yet: the list says so, and in editing the reader can add the first. */
export function Empty() {
  const [steps, setSteps] = useState<RouteListStep[]>([]);
  return <RouteList label="Route" empty="No stages. The agent follows the plan's prose." steps={steps}
    gap={(after) => after === undefined ? <TextButton label="Add a stage here" onPress={() => setSteps([{ key: "first", number: 1, name: "Recon", added: true }])} /> : null} />;
}
