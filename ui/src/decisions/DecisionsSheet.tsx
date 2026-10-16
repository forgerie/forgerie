import { useState } from "react";
import { SheetDialog } from "../ui/SheetDialog";
import { DecisionLog } from "./DecisionLog";
import { OverturnFooter } from "./OverturnFooter";
import { logSummary, type DecisionLogActions, type DecisionLogView } from "./decisionsModel";

/**
 * Shape: the session's decision log, opened from its header: flagged guesses
 * first, in full, then every other decision one line each, by day. Overturn
 * opens a note field in the footer; the sheet stays open through a failure and
 * says why there.
 */
export function DecisionsSheet({ log, actions, initialTarget, now: clock = Date.now, onClose }: {
  log: DecisionLogView;
  actions: DecisionLogActions;
  /** A decision whose note field is open from the start. */
  initialTarget?: string | undefined;
  /** The clock the ages are measured from. */
  now?: () => number;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState(initialTarget);
  const target = log.decisions?.find((decision) => decision.id === chosen && decision.state.kind === "standing");
  const overturn = actions.onOverturn;
  const pending = log.overturning !== undefined;
  const close = () => { setChosen(undefined); actions.onDismissError(); };
  const footer = overturn !== undefined && (target !== undefined || log.error !== undefined) ? <OverturnFooter target={target} pending={pending} error={log.error}
    onSend={async (note) => { if (target === undefined) return false; const done = await overturn(target.id, note); if (done) setChosen(undefined); return done; }}
    onCancel={close} onDismissError={close} /> : undefined;
  return <SheetDialog title="Decisions" subtitle={logSummary(log.decisions)} closeLabel="Close the decisions" onClose={onClose} footer={footer}>
    <DecisionLog decisions={log.decisions} readError={log.readError} now={clock()} target={target?.id} busy={pending}
      onRetry={actions.onRetry} onChoose={overturn === undefined ? undefined : (id) => {
        actions.onDismissError();
        setChosen((current) => current === id ? undefined : id);
      }} />
  </SheetDialog>;
}
