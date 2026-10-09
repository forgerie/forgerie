import { useEffect, useState } from "react";
import { AlertCard, type AlertAction } from "../ui/AlertCard";
import type { Problem } from "../sessionStore";

export type ConnectionTrouble =
  | { type: "reconnecting"; reason: string; attempt: number; retryAt: number; lastReadyAt?: number | undefined }
  | { type: "failed"; reason: string };

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Time until the next try, in words. Ticks once a second only while there is a wait to count. */
function useNow(clockNow: () => number, until: number | undefined) {
  const [now, setNow] = useState(clockNow);
  useEffect(() => {
    if (until === undefined) return;
    setNow(clockNow());
    const timer = setInterval(() => setNow(clockNow()), 1000);
    return () => clearInterval(timer);
  }, [clockNow, until]);
  return now;
}

/**
 * Shape: what the session's status chip opens. Connection trouble first, as
 * a card that says why and what happens next, then each problem in full,
 * newest first. Each problem can be copied and dismissed on its own.
 */
export function StatusDetail({ connection, problems, draftSaved, onTryNow, onReload, onDismiss, onCopy, now = Date.now }: {
  connection?: ConnectionTrouble | undefined;
  problems: readonly Problem[];
  /** The draft outlives a reload. */
  draftSaved: boolean;
  onTryNow: () => void;
  onReload: () => void;
  onDismiss: (id: number) => void;
  /** Absent where the page cannot write to the clipboard. */
  onCopy?: ((text: string) => void) | undefined;
  now?: () => number;
}) {
  const current = useNow(now, connection?.type === "reconnecting" ? connection.retryAt : undefined);
  return <>
    {connection?.type === "reconnecting" && (() => {
      const seconds = Math.ceil((connection.retryAt - current) / 1000);
      return <AlertCard label="Connection lost" tone="warn" title="The live connection dropped"
        actions={[{ label: "Try now", onPress: onTryNow, disabled: seconds <= 0 }]}>
        <p>{connection.reason} Forgerie tries again on its own: try <strong>{connection.attempt}</strong>{" "}
          {seconds > 0 ? <>starts in <strong>{seconds} s</strong>.</> : "is running now."}
          {connection.lastReadyAt !== undefined && <> Last live at {clock(connection.lastReadyAt)}.</>}{" "}
          Your draft stays here.</p>
      </AlertCard>;
    })()}
    {connection?.type === "failed" && <AlertCard label="Disconnected" title="Forgerie stopped trying" code={connection.reason} codeLabel="Reason"
      actions={[{ label: "Reload", onPress: onReload }]}>
      <p>Trying again would not help. Reload the page to connect again.{draftSaved ? " Your draft is saved." : ""}</p>
    </AlertCard>}
    {problems.map((problem) => {
      const actions: AlertAction[] = [
        ...(onCopy ? [{ label: "Copy", onPress: () => onCopy(problem.message) }] : []),
        { label: "Dismiss", onPress: () => onDismiss(problem.id) },
      ];
      return <AlertCard key={problem.id} label={problem.title} title={problem.title} time={clock(problem.at)} actions={actions}>
        <p>{problem.message}</p>
      </AlertCard>;
    })}
  </>;
}
