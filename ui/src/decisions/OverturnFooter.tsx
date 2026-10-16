import { ActionFooter } from "../ui/ActionFooter";
import { ReplyBox } from "../ui/ReplyBox";
import { shortChoice, type Decision } from "./decisionsModel";

/**
 * Shape: a sheet's footer while the reader overturns a decision. It names the
 * choice being overturned and who gets the note (the child the choice went to
 * while it still runs, else the parent agent), then the note field with
 * Cancel. The note stays in the field until the server takes it. A failed
 * overturn says why here, and the field stays for another try; a failure with
 * no field left, such as a decision another tab overturned first, can be
 * dismissed.
 */
export function OverturnFooter({ target, pending, error, onSend, onCancel, onDismissError }: {
  /** The standing or confirmed decision whose note field is open. */
  target?: Decision | undefined;
  pending: boolean;
  /** Why the last overturn failed. */
  error?: string | undefined;
  /** Resolves true once the server took the note. */
  onSend: (note: string) => Promise<boolean>;
  onCancel: () => void;
  onDismissError: () => void;
}) {
  if (target === undefined) return <ActionFooter problem={error} actions={[{ label: "Dismiss", onPress: onDismissError }]} />;
  // A short footer leaves the list little room: the failure replaces the explanation, which the reader has already read.
  // A gated action already ran: the note cannot undo it, so the footer says so and does not promise a redo.
  const gated = target.kind === "gated";
  const note = pending ? "Sending your note…" : error !== undefined ? undefined
    : gated ? `Correct “${shortChoice(target.question).replace(/\.+$/u, "")}”. The action already ran. The agent that asked for it gets your note; if it has finished, the parent agent does.`
    : `Overturn “${shortChoice(target.choice).replace(/\.+$/u, "")}”. The agent that acted on it gets your note and redoes the work; if it has finished, the parent agent does.`;
  return <ActionFooter note={note} problem={pending ? undefined : error} actions={[]} input={<ReplyBox key={target.id} label="What should be done instead?" placeholder="Say what to do instead"
    sendLabel={gated ? "Send correction" : "Send and overturn"} autoFocus disabled={pending} secondary={{ label: "Cancel", onPress: onCancel, disabled: pending }}
    onSend={async (text) => { if (!await onSend(text)) throw new Error("Not sent"); }} />} />;
}
