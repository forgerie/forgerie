import type { ComponentProps } from "react";
import { Toast } from "../ui/Toast";
import { TriggerList } from "./TriggerList";
import { TriggerPage } from "./TriggerPage";
import { TriggerDialog, type TriggerQuestion } from "./TriggerDialog";
import type { WordClock } from "./triggerWords";

/** What the screen shows: the list, or one trigger's page (a new one included). */
export type TriggerScreen =
  | { view: "list"; list: ComponentProps<typeof TriggerList> }
  | { view: "page"; page: ComponentProps<typeof TriggerPage> };

/** A short message that does not stop the reader. */
export interface TriggerNote { text: string; tone?: "plain" | "alert" | undefined }

/**
 * Shape: the triggers screen in the thread's place: the list or a trigger's
 * page, the one confirmation it may be asking, and its latest message.
 */
export function TriggersView({ screen, question, note, clock, projectLabel, onConfirm, onCancel, onDismissNote }: {
  screen: TriggerScreen;
  question?: TriggerQuestion | undefined;
  note?: TriggerNote | undefined;
  clock: WordClock;
  projectLabel: (cwd: string) => string;
  onConfirm: () => void; onCancel: () => void; onDismissNote: () => void;
}) {
  return <>
    {screen.view === "list" ? <TriggerList {...screen.list} /> : <TriggerPage {...screen.page} />}
    {question ? <TriggerDialog question={question} clock={clock} projectLabel={projectLabel} onConfirm={onConfirm} onCancel={onCancel} /> : null}
    {note ? <Toast tone={note.tone} message={note.text} onDismiss={onDismissNote} durationMs={note.tone === "alert" ? undefined : 8000} timerKey={note} /> : null}
  </>;
}
