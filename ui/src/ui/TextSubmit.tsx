import { useEffect, useId, useRef, useState } from "react";
import "./TextSubmit.css";

/**
 * A refused value can come back with one way forward, such as an offer to
 * create what is missing. The reader confirms it in place or cancels it.
 */
export interface TextSubmitFollowUp {
  message: string;
  /** The button that runs the follow-up, named for what it does. */
  action: string;
  run: () => Promise<void>;
}

/**
 * Molecule: one typed value and the action that sends it. The label sits
 * above; the field and the button share a row while the container has room,
 * and the button drops under the field when it does not. A refused value
 * stays in the field so the reader can fix it. When `onSubmit` returns a
 * follow-up, it waits under the field until the reader confirms it, cancels
 * it, or edits the value it was for. A refusal given as `error` shows under
 * the field until the next submit.
 */
export function TextSubmit({ label, hint, action, placeholder, pending, error, onSubmit }: {
  label: string; hint?: string | undefined; action: string; placeholder: string; pending: boolean;
  /** Why the last value was refused, in the server's words. */
  error?: string | undefined;
  onSubmit: (value: string) => Promise<TextSubmitFollowUp | void>;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [followUp, setFollowUp] = useState<TextSubmitFollowUp>();
  const offer = useRef<HTMLDivElement>(null);
  // The field often sits at the foot of a scrolling page, so the offer would open out of sight.
  useEffect(() => { if (followUp) offer.current?.scrollIntoView?.({ block: "nearest" }); }, [followUp]);
  const done = () => { setFollowUp(undefined); setValue(""); };
  return <form className="text-submit" onSubmit={(event) => {
    event.preventDefault(); setFollowUp(undefined);
    void onSubmit(value.trim()).then((next) => { if (next) setFollowUp(next); else done(); }).catch(() => undefined);
  }}>
    <label className="text-submit-label" htmlFor={id}>{label}</label>
    {hint ? <p className="text-submit-hint" id={`${id}-hint`}>{hint}</p> : null}
    <div className="text-submit-row">
      <input className="text-submit-input" id={id} placeholder={placeholder} value={value} disabled={pending} aria-describedby={hint ? `${id}-hint` : undefined}
        autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(event) => { setValue(event.target.value); setFollowUp(undefined); }} />
      <button className="text-submit-button" type="submit" disabled={pending || !value.trim()}>{action}</button>
    </div>
    {error ? <p className="text-submit-error" role="alert">{error}</p> : null}
    <div className="text-submit-follow-up" aria-live="polite" ref={offer}>
      {followUp ? <>
        <p className="text-submit-follow-up-message">{followUp.message}</p>
        <div className="text-submit-follow-up-actions">
          <button className="text-submit-button" type="button" data-emphasis="strong" disabled={pending}
            onClick={() => { void followUp.run().then(done).catch(() => undefined); }}>{followUp.action}</button>
          <button className="text-submit-button" type="button" data-emphasis="quiet" disabled={pending} onClick={() => setFollowUp(undefined)}>Cancel</button>
        </div>
      </> : null}
    </div>
  </form>;
}
