import { useState } from "react";
import { ResourceDocument } from "./ResourceDocument";
import { bundledHandoff, entries, mobbinFile, sessionInventory, settingsInventory, testingGuideFile } from "./fixtures/resources";

export const name = "Skill or prompt file";
export const note = "One file's exact text, with where it comes from and what saving does";
export const composition = { default: [
  { part: "src/ui/FileFrame.organism.part.tsx", state: "default" },
  { part: "src/ui/Lede.atom.part.tsx", state: "default" },
] };

const hidden = entries.find((entry) => entry.activation.kind === "shadowed");

export default function ProjectFile() {
  const [text, setText] = useState(testingGuideFile.text);
  return <>
    <ResourceDocument entry={testingGuideFile.resource} hides={[]} scope={sessionInventory.scope} text={testingGuideFile.text}
      onChange={setText} onSave={() => undefined} />
    <p>{text === testingGuideFile.text ? "No edits" : "Unsaved edits"}</p>
  </>;
}
export function MainCheckout() {
  return <ResourceDocument entry={{ ...testingGuideFile.resource, edit: { kind: "writable", saveEffect: "commit" } }} hides={[]}
    scope={sessionInventory.scope} text={testingGuideFile.text} onChange={() => undefined} onSave={() => undefined}
    report={{ kind: "saved", message: "Saved and committed as 0123456 on main." }} />;
}
export function PackageFile() {
  return <ResourceDocument entry={mobbinFile.resource} hides={[]} scope={settingsInventory.scope} text={mobbinFile.text}
    onChange={() => undefined} onSave={() => undefined} />;
}
export function Hidden() {
  return hidden ? <ResourceDocument entry={hidden} hiddenBy={bundledHandoff} hides={[]} scope={settingsInventory.scope}
    text={"---\nname: handoff\ndescription: Compact the conversation into a handoff document.\n---\n"} onChange={() => undefined} onSave={() => undefined} /> : <p>No hidden file</p>;
}
export function Conflict() {
  return <ResourceDocument entry={testingGuideFile.resource} hides={[]} scope={sessionInventory.scope} text={`${testingGuideFile.text}A draft line.\n`}
    onChange={() => undefined} onSave={() => undefined}
    report={{ kind: "refused", message: "This file changed on disk. Read it again before saving.", advice: "Your edits are still here. Read the file again to see the new version; that drops your edits." }} />;
}
