import { CircleAlertIcon, FileXIcon, InfoIcon, SlidersHorizontalIcon } from "lucide-react";
import { Consequence } from "../ui/Consequence";

/** One thing about a workflow file the reader must see before its text. */
export type FileNotice =
  /** What Save does. `when` is the next run, set strong. */
  | { kind: "saving"; before: string; when?: string | undefined; after: string }
  /** The file cannot be read as a schedule; the last good settings run meanwhile. */
  | { kind: "invalid"; title: string; message: string; running: string; line?: number | undefined; onShowLine?: (() => void) | undefined; onPause?: (() => void) | undefined }
  /** The file, or its schedule block, is gone. */
  | { kind: "missing"; title: string; text: string }
  /** The server refused a save, in its words, and the next step. */
  | { kind: "refused"; message: string; line?: number | undefined; onShowLine?: (() => void) | undefined }
  /** Side-panel values the text in Source does not show yet. */
  | { kind: "panel" };

/**
 * Shape: one notice above a workflow file, set apart by a wash and an icon: what saving does, a line the server
 * cannot read with what runs meanwhile, a file that is gone, a refused save, or side-panel values the source does not
 * show yet. A notice with a line offers to show it in Source.
 */
export function TriggerFileNotice({ notice }: { notice: FileNotice }) {
  switch (notice.kind) {
    case "saving":
      return <Consequence icon={<InfoIcon />}><p>{notice.before}{notice.when ? <strong>{notice.when}</strong> : null}{notice.after}</p></Consequence>;
    case "invalid":
      return <Consequence tone="warn" icon={<CircleAlertIcon />} actions={[
        ...notice.onShowLine && notice.line !== undefined ? [{ label: `Show line ${String(notice.line)}`, onPress: notice.onShowLine }] : [],
        ...notice.onPause ? [{ label: "Pause until fixed", onPress: notice.onPause }] : [],
      ]}>
        <p><strong>{notice.title}</strong> {notice.message}</p>
        <p>{notice.running}</p>
      </Consequence>;
    case "missing":
      return <Consequence tone="warn" icon={<FileXIcon />}><p><strong>{notice.title}</strong> {notice.text}</p></Consequence>;
    case "refused":
      return <Consequence tone="warn" icon={<CircleAlertIcon />}
        actions={notice.onShowLine && notice.line !== undefined ? [{ label: `Show line ${String(notice.line)}`, onPress: notice.onShowLine }] : undefined}>
        <p><strong>Forgerie did not save the file.</strong> {notice.line === undefined ? null : `Line ${String(notice.line)}: `}{notice.message}</p>
        <p>{notice.line === undefined ? "Change what it names, then save again. Your text stays here until you do." : "Fix that line, then save again. Your text stays here until you do."}</p>
      </Consequence>;
    case "panel":
      return <Consequence icon={<SlidersHorizontalIcon />}>
        <p>Your side-panel changes are not in this text yet. They apply when you save: Forgerie writes them into the schedule block.</p>
      </Consequence>;
  }
}
