import { FileTextIcon, XIcon } from "lucide-react";
// The dialog opens without the backlog page, so the card brings its own rules.
import "./backlog.css";

/** What the window knows about the item riding with the first message. */
export type CarryState =
  | { type: "loading" }
  /**
   * `where` replaces the default line, for an item that is not a file. `route` says where the session starts, when the
   * caller has something to say about it; `attention` marks a route the reader must settle before Start.
   */
  | { type: "ready"; title: string; where?: string | undefined; route?: { text: string; attention: boolean } | undefined }
  /** The item cannot start a session now: it is done, blocked, or could not be read. */
  | { type: "unavailable"; title?: string | undefined; reason: string }
  /** Another session holds it. `name` and `when` come from the session list when it knows that session. */
  | { type: "taken"; title: string; name?: string | undefined; when?: string | undefined; onOpen?: (() => void) | undefined };

/**
 * System molecule: the backlog item riding with a new session's first
 * message. It sits at the top of the writing area, where attachments go. A
 * refusal sits under it, so a short window shows both without a scroll.
 */
export function BacklogCarry({ state, onRemove }: { state: CarryState; onRemove: () => void }) {
  const title = state.type === "loading" ? "Reading the backlog item…" : state.title ?? "Backlog item";
  const where = state.type === "taken" ? <>Taken by <em>{state.name ?? "another session"}</em>{state.when ? <> {state.when} ago</> : null}</>
    : state.type === "unavailable" ? state.reason
    : state.type === "ready" && state.where ? state.where
    : "Backlog item. The whole file goes with the first message.";
  const refused = state.type === "taken" || state.type === "unavailable";
  return <>
    <div className="bl-carry" data-refused={refused || undefined} aria-busy={state.type === "loading" || undefined}>
      <FileTextIcon aria-hidden size={18} />
      <span className="bl-carry-text">
        <span className="bl-carry-title">{title}</span>
        <span className="bl-carry-where">{where}</span>
        {state.type === "ready" && state.route ? <span className="bl-carry-route" data-attention={state.route.attention || undefined}>{state.route.text}</span> : null}
      </span>
      <button type="button" className="icon-button quiet-button" aria-label="Start without this item" title="Start without this item" onClick={onRemove}>
        <XIcon aria-hidden size={16} /></button>
    </div>
    {state.type === "taken" ? <div className="bl-refusal" role="alert">
      <p>{state.name ?? "Another session"} took this item first, so this session did not start. Your message is still here.</p>
      <span className="bl-refusal-actions">
        {state.onOpen ? <button type="button" onClick={state.onOpen}>Open {state.name ?? "that session"}</button> : null}
        <button type="button" onClick={onRemove}>Start without the item</button>
      </span>
    </div> : null}
  </>;
}
