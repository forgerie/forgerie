import { useEffect, useState } from "react";
import type { ChainWait, SessionModel } from "../contracts";
import { chainEntryLabel } from "../modelChoice";
import { Figure } from "../ui/Figure";
import { ReadoutLine } from "../ui/ReadoutLine";
import { TextButton } from "../ui/TextButton";
import { chainWaitClock, chainWaitLeft } from "./chainWait";

/** The time now, once a second while a wait runs. A fixed `now` stands still, for a picture of one moment. */
function useClock(fixed: number | undefined): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [fixed]);
  return fixed ?? now;
}

/**
 * Shape: a session's model chain waits after a model was unavailable, as one quiet line above the input: how long is
 * left, the model it waits for, and the model it moves to next, as the server names it. A wait without `to` retries
 * the same model, so the line names no other. What the provider answered is the line's tooltip. Stop ends the wait
 * with the run, when the input bar has no Stop of its own.
 */
export function ChainWaitStatus({ wait, models = [], now: fixed, onStop }: {
  wait: ChainWait;
  models?: readonly SessionModel[] | undefined;
  /** A fixed time instead of the clock. */
  now?: number | undefined;
  onStop?: (() => void) | undefined;
}) {
  const now = useClock(fixed);
  const left = chainWaitLeft(wait, now);
  const from = chainEntryLabel(wait.from, models);
  const then = wait.to === undefined ? undefined : chainEntryLabel(wait.to, models);
  const seconds = Math.ceil(left / 1_000);
  return <ReadoutLine action={onStop ? <TextButton label="Stop" title="Stop the run instead of waiting" onPress={onStop} /> : undefined}>
    <span title={wait.error.trim() || undefined}>
      {left > 0 ? <>Waiting <Figure tone="plain" label={`${String(seconds)} ${seconds === 1 ? "second" : "seconds"} left`}>{chainWaitClock(left)}</Figure> for <strong>{from}</strong>
        {then === undefined ? null : <>, then <strong>{then}</strong></>}</>
        : <>Moving on from <strong>{from}</strong>{then === undefined ? null : <> to <strong>{then}</strong></>}…</>}
    </span>
  </ReadoutLine>;
}
