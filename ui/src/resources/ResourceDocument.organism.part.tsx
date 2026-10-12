import { useState } from "react";
import { ResourceDocument, type SaveReport } from "./ResourceDocument";
import type { ResourceEntry, ResourceScope } from "./resourceApi";
import type { MarkdownView } from "../ui/useMarkdownView";
import { loadMarkdownKit } from "../ui/markdownKit";
import { bundledHandoff, decompositionFile, entries, largeContextFile, mobbinFile, sessionInventory, settingsInventory, testingGuideFile } from "./fixtures/resources";

// Frames show the editor drawn, not the moment before Tiptap arrives.
await loadMarkdownKit();

export const name = "Skill or prompt file";
export const note = "One file's exact text, with where it comes from and what saving does";
export const composition = { default: [
  { part: "src/ui/FileFrame.organism.part.tsx", state: "default" },
  { part: "src/ui/Lede.atom.part.tsx", state: "default" },
  { part: "src/ui/MarkdownEditor.organism.part.tsx", state: "FrontMatter" },
  { part: "src/ui/ToggleGroup.molecule.part.tsx", state: "default" },
], TooLarge: [
  { part: "src/ui/ToggleGroup.molecule.part.tsx", state: "OneUnavailable" },
], Lossy: [
  { part: "src/ui/MarkdownEditor.organism.part.tsx", state: "Lossy" },
], PackageFile: [
  { part: "src/ui/MarkdownEditor.organism.part.tsx", state: "ReadOnly" },
] };

const hidden = entries.find((entry) => entry.activation.kind === "shadowed");

/** The file with real edits and a real switch: the view is the part's own, as the binding keeps it on the device. */
function Stateful({ entry, text, draft, scope, view: initialView = "rich", hiddenBy, report }: {
  entry: ResourceEntry; text: string; draft?: string; scope: ResourceScope; view?: MarkdownView; hiddenBy?: ResourceEntry; report?: SaveReport;
}) {
  const [current, setCurrent] = useState(draft ?? text);
  const [view, setView] = useState(initialView);
  return <>
    <ResourceDocument entry={entry} hiddenBy={hiddenBy} hides={[]} scope={scope} text={current} report={report}
      view={view} onView={setView} onChange={setCurrent} onSave={() => undefined} />
    <p>{current === text ? "No edits" : "Unsaved edits"}</p>
  </>;
}

export default function ProjectFile() {
  return <Stateful entry={testingGuideFile.resource} text={testingGuideFile.text} scope={sessionInventory.scope} />;
}
export function SourceView() {
  return <Stateful entry={testingGuideFile.resource} text={testingGuideFile.text} scope={sessionInventory.scope} view="source" />;
}
/** Edits typed in Source, then the switch to Rich: the formatted file shows them, and they are still unsaved. */
export function DirtyAfterSwitch() {
  return <Stateful entry={testingGuideFile.resource} text={testingGuideFile.text} scope={sessionInventory.scope}
    draft={`${testingGuideFile.text}\n## Before a commit\n\n- [ ] Run the narrowest test first.\n- [ ] Then run the suite.\n`} />;
}
/** A real file of this repository with tables: the rich view shows it read-only, with a way to its source. */
export function Lossy() {
  return <Stateful entry={decompositionFile.resource} text={decompositionFile.text} scope={sessionInventory.scope} />;
}
export function TooLarge() {
  return <Stateful entry={largeContextFile.resource} text={largeContextFile.text} scope={sessionInventory.scope} />;
}
export function MainCheckout() {
  return <Stateful entry={{ ...testingGuideFile.resource, edit: { kind: "writable", saveEffect: "commit" } }} text={testingGuideFile.text}
    scope={sessionInventory.scope} report={{ kind: "saved", message: "Saved and committed as 0123456 on main." }} />;
}
export function PackageFile() {
  return <Stateful entry={mobbinFile.resource} text={mobbinFile.text} scope={settingsInventory.scope} />;
}
export function Hidden() {
  return hidden ? <Stateful entry={hidden} hiddenBy={bundledHandoff} scope={settingsInventory.scope}
    text={"---\nname: handoff\ndescription: Compact the conversation into a handoff document.\n---\n"} /> : <p>No hidden file</p>;
}
export function Conflict() {
  return <Stateful entry={testingGuideFile.resource} text={testingGuideFile.text} draft={`${testingGuideFile.text}A draft line.\n`} scope={sessionInventory.scope}
    report={{ kind: "refused", message: "This file changed on disk. Read it again before saving.", advice: "Your edits are still here. Read the file again to see the new version; that drops your edits." }} />;
}
