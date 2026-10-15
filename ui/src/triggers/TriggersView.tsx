import type { ComponentProps } from "react";
import { Toast } from "../ui/Toast";
import { TriggerList } from "./TriggerList";
import { TriggerPage } from "./TriggerPage";
import { TriggerFilePage } from "./TriggerFilePage";
import { TriggerDialog, type RunScope, type TriggerQuestion } from "./TriggerDialog";
import type { WordClock } from "./triggerWords";

/** What the screen shows: the list, or one trigger's page (a new one included). */
export type TriggerScreen =
  | { view: "list"; list: ComponentProps<typeof TriggerList> }
  | { view: "page"; page: ComponentProps<typeof TriggerPage> }
  /** A trigger whose settings live in a workflow file: that file's page. */
  | { view: "file"; page: ComponentProps<typeof TriggerFilePage> };

/** A short message that does not stop the reader. */
export interface TriggerNote { text: string; tone?: "plain" | "alert" | undefined }

/**
 * Shape: the triggers screen in the thread's place: the list, a trigger's
 * page, or the page of the workflow file that holds a trigger, the one confirmation it may be asking, and its latest message.
 */
export function TriggersView({ screen, question, note, clock, projectLabel, onConfirm, onCancel, onScope, onDismissNote }: {
  screen: TriggerScreen;
  question?: TriggerQuestion | undefined;
  note?: TriggerNote | undefined;
  clock: WordClock;
  projectLabel: (cwd: string) => string;
  onConfirm: () => void; onCancel: () => void; onDismissNote: () => void;
  /** Run now's choice of all target projects or one. */
  onScope?: ((scope: RunScope) => void) | undefined;
}) {
  return <>
    {screen.view === "list" ? <TriggerList {...screen.list} /> : screen.view === "file" ? <TriggerFilePage {...screen.page} /> : <TriggerPage {...screen.page} />}
    {question ? <TriggerDialog question={question} clock={clock} projectLabel={projectLabel} onConfirm={onConfirm} onCancel={onCancel} onScope={onScope} /> : null}
    {note ? <Toast tone={note.tone} message={note.text} onDismiss={onDismissNote} durationMs={note.tone === "alert" ? undefined : 8000} timerKey={note} /> : null}
  </>;
}
