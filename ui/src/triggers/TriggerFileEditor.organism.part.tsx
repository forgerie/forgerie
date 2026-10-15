import { useState } from "react";
import { TriggerFileEditor, type LineJump } from "./TriggerFileEditor";
import { TriggerFileNotice } from "./TriggerFileNotice";
import type { MarkdownView } from "../ui/useMarkdownView";
import { BROKEN_TEXT, MAINTENANCE_PATH, MAINTENANCE_TEXT } from "./fixtures/triggerFiles";
import { loadMarkdownKit } from "../ui/markdownKit";

// Frames show the editor drawn, not the moment before Tiptap arrives.
await loadMarkdownKit();

export const name = "Trigger file editor";
export const note = "A workflow file as the page's document: where it lives, Rich or Source, and the notices before its text";
export const composition = { default: [{ part: "src/ui/MarkdownEditor.organism.part.tsx", state: "FrontMatterHidden" }],
  Source: [{ part: "src/ui/CodeEditor.molecule.part.tsx", state: "Markdown" }] };

function Editor({ start = "rich", text = MAINTENANCE_TEXT, markLine, jumpTo, panel = false }: {
  start?: MarkdownView; text?: string; markLine?: number; jumpTo?: number; panel?: boolean;
}) {
  const [view, setView] = useState(start);
  const [jump] = useState<LineJump | undefined>(jumpTo === undefined ? undefined : { line: jumpTo, at: 1 });
  return <TriggerFileEditor path={MAINTENANCE_PATH} text={text} document="fixture" view={view} onView={setView} markLine={markLine} jump={jump}
    sourceNotice={panel ? <TriggerFileNotice notice={{ kind: "panel" }} /> : null} onChange={() => undefined} onSave={() => undefined} />;
}
/** Rich: the prose alone. The front matter is the side panel. */
export default function Rich() { return <Editor />; }
export function Source() { return <Editor start="source" />; }
/** Show line 5 opened Source with the caret on the marked line. */
export function ShowLine() { return <Editor start="rich" text={BROKEN_TEXT} markLine={5} jumpTo={5} />; }
/** Side-panel changes are waiting, and Source says so. */
export function SourceWithPanelChanges() { return <Editor start="source" panel />; }
