import { CircleAlertIcon, CircleCheckIcon, InfoIcon, LockIcon } from "lucide-react";
import { CodeEditor } from "../ui/CodeEditor";
import { Consequence } from "../ui/Consequence";
import { Lede } from "../ui/Lede";
import { FileFrame } from "../ui/FileFrame";
import type { ResourceEntry, ResourceScope } from "./resourceApi";
import { ORIGIN_LABELS, placed, saveConsequence } from "./resourceModel";

/** What the last save said: done, or refused with the server's words and the next step. */
export type SaveReport = { kind: "saved"; message: string } | { kind: "refused"; message: string; advice?: string | undefined };

const fileName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

/**
 * Organism: one skill, prompt template or context file, as its exact text.
 * Above it: where it comes from, what it hides or what hides it, and what
 * saving will do, or why it is read-only. The caller keys it by file and
 * revision, so reading the file again starts a fresh editor.
 */
export function ResourceDocument({ entry, hiddenBy, hides, scope, text, report, onChange, onSave }: {
  entry: ResourceEntry;
  /** The file Pi uses instead of this one, when this one is hidden. */
  hiddenBy?: ResourceEntry | undefined;
  /** Files this one hides. */
  hides: readonly ResourceEntry[];
  scope: ResourceScope | undefined;
  /** The text the editor starts from. */
  text: string;
  report?: SaveReport | undefined;
  onChange: (text: string) => void; onSave: () => void;
}) {
  const readOnly = entry.edit.kind === "read-only";
  const facts = <Lede>
    {ORIGIN_LABELS[entry.origin.kind]}{entry.origin.kind === "package" ? <>, from <code>{entry.origin.source}</code></> : null}: <code>{entry.path}</code>
    {hiddenBy ? <><br />Hidden by {placed(hiddenBy)}. Pi uses that file instead.</> : null}
    {hides.length ? <><br />Hides {hides.map(placed).join(", ")}.</> : null}
  </Lede>;
  const effect = saveConsequence(entry, scope);
  return <FileFrame facts={facts} notices={[
    report?.kind === "refused" ? <Consequence key="report" tone="warn" icon={<CircleAlertIcon />}>
      <p><strong>{report.message}</strong></p>{report.advice ? <p>{report.advice}</p> : null}</Consequence> : null,
    report?.kind === "saved" ? <Consequence key="report" icon={<CircleCheckIcon />}>{report.message}</Consequence> : null,
    entry.activation.kind === "invalid" ? <Consequence key="invalid" tone="warn" icon={<CircleAlertIcon />}>
      <p><strong>Pi skips this file.</strong> {entry.activation.message}</p></Consequence> : null,
    entry.edit.kind === "read-only" ? <Consequence key="lock" icon={<LockIcon />}>{entry.edit.reason}</Consequence> : null,
    effect ? <Consequence key="effect" tone={entry.edit.kind === "writable" && entry.edit.saveEffect === "commit" ? "warn" : "plain"} icon={<InfoIcon />}>{effect}</Consequence> : null,
  ]}>
    <CodeEditor label={`${readOnly ? "Read" : "Edit"} ${entry.name}`} fileName={fileName(entry.path)} text={text} readOnly={readOnly}
      onChange={onChange} onSave={onSave} />
  </FileFrame>;
}
