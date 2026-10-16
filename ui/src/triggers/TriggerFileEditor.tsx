import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { InfoIcon } from "lucide-react";
import { CodeEditor } from "../ui/CodeEditor";
import { Consequence } from "../ui/Consequence";
import { FileFrame } from "../ui/FileFrame";
import { Lede } from "../ui/Lede";
import { MarkdownEditor } from "../ui/MarkdownEditor";
import { ToggleGroup } from "../ui/ToggleGroup";
import { MARKDOWN_WORDS, useMarkdownView, type MarkdownView } from "../ui/useMarkdownView";
import { fileName } from "./triggerFile";

/** A request to show one line of the file in Source. `at` changes with each request, so asking twice shows it again. */
export interface LineJump { line: number; at: number }

/**
 * Shape: a workflow file as the page's document, with where it lives and Rich
 * or Source along its top. Rich shows the prose formatted and editable; its
 * front matter is the side panel, so it is not repeated here, and a save keeps
 * it. Source shows the whole file. A jump opens Source with the caret on that
 * line; `markLine` marks a line the server could not read. The caller keys it
 * by the editing base, so adopting another file version or restoring text starts a fresh editor.
 */
export function TriggerFileEditor({ path, text, document, view, onView, notices, sourceNotice, markLine, jump, readOnly = false, onChange, onSave }: {
  path: string;
  /** The text the editor starts from, edits included. */
  text: string;
  /** Names this read of the file, for the Rich view's check. */
  document: string;
  view: MarkdownView;
  onView: (view: MarkdownView) => void;
  /** What the reader must see before the text, in reading order. */
  notices?: readonly ReactNode[];
  /** A notice only Source needs, such as values the text does not show yet: last, next to the text. */
  sourceNotice?: ReactNode;
  markLine?: number | undefined;
  jump?: LineJump | undefined;
  readOnly?: boolean | undefined;
  onChange: (text: string) => void; onSave: () => void;
}) {
  // Either view starts from the text as it is now, so a switch keeps the edits.
  const current = useRef(text);
  const change = (next: string) => { current.current = next; onChange(next); };
  const plan = useMarkdownView({ path, document, text: current.current, preferred: view, onPrefer: onView });
  const editSource = plan.editSource;
  useEffect(() => { if (jump) editSource(); }, [jump, editSource]);
  const name = fileName(path);
  const label = `${readOnly ? "Read" : "Edit"} ${name}`;
  return <FileFrame facts={<Lede>Global workflow: <code>{path}</code></Lede>}
    notices={[...notices ?? [], plan.view === "source" && sourceNotice ? <Fragment key="source">{sourceNotice}</Fragment> : null, plan.tooLarge ? <Consequence key="large" icon={<InfoIcon />}>{MARKDOWN_WORDS.tooLarge}</Consequence> : null]}
    tools={<ToggleGroup label={MARKDOWN_WORDS.switchLabel} options={plan.options} value={plan.view} onChange={plan.choose} />}>
    {plan.pending ? <Lede>Opening the file…</Lede> : plan.view === "rich"
      ? <MarkdownEditor key="rich" label={label} text={current.current} frontMatter="hidden" readOnly={readOnly || plan.lossy !== undefined}
        notice={!readOnly && plan.lossy !== undefined ? { message: MARKDOWN_WORDS.lossy(plan.lossy), action: { label: MARKDOWN_WORDS.editSource, onPress: plan.editSource } } : undefined}
        onChange={change} onSave={onSave} />
      : <CodeEditor key={`source-${String(jump?.at ?? 0)}`} label={label} fileName={name} text={current.current} readOnly={readOnly}
        markLine={markLine} goToLine={jump?.line} onChange={change} onSave={onSave} />}
  </FileFrame>;
}
