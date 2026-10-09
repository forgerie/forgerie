import { FloatingPanel } from "./FloatingPanel";
import { OptionList } from "./OptionList";

export const name = "Floating panel";
export const note = "The surface of a window-level panel; its host places it";

const options = Array.from({ length: 14 }, (_, i) => ({ id: `project-${i}`, name: `Project ${i + 1}`,
  details: [{ text: `/home/someone/code/project-${i + 1}`, truncate: "start" as const }] }));

/** A part has no anchor, so the panel shows unplaced: inside the window edges, with the list scrolling. */
export default function WithList() {
  return <FloatingPanel role="dialog" aria-label="Where the session starts">
    <OptionList label="Projects" groups={[{ key: "projects", options }]} input={{ type: "focus", onChoose: () => {} }}
      search={{ value: "", onChange: () => {}, label: "Search projects", placeholder: "Search projects" }} />
  </FloatingPanel>;
}
