import { useState, type KeyboardEvent } from "react";
import { ArrowUpIcon } from "lucide-react";
import "./ReplyBox.css";

/**
 * Molecule: a short text field with a send control, and an optional second
 * action beside it, such as stop. Enter sends; Shift+Enter adds a line. The
 * text stays until the send succeeds, so a failure loses nothing.
 */
export function ReplyBox({ label, placeholder, sendLabel, onSend, disabled = false, secondary, autoFocus = false }: {
  /** Accessible name of the field. */
  label: string;
  placeholder: string;
  sendLabel: string;
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
  secondary?: { label: string; onPress: () => void; disabled?: boolean } | undefined;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const empty = text.trim() === "";
  async function send() {
    if (empty || sending || disabled) return;
    setSending(true);
    try { await onSend(text); setText(""); } catch { /* The owner shows the failure; the text stays. */ } finally { setSending(false); }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
  };
  return <div className="reply-box" data-disabled={disabled || undefined}>
    <textarea className="reply-box-field" aria-label={label} placeholder={placeholder} rows={1} value={text} disabled={disabled}
      autoFocus={autoFocus} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
    {secondary && <button type="button" className="reply-box-secondary" disabled={secondary.disabled} onClick={secondary.onPress}>{secondary.label}</button>}
    <button type="button" className="reply-box-send" aria-label={sendLabel} title={sendLabel} disabled={empty || sending || disabled}
      onClick={() => { void send(); }}><ArrowUpIcon aria-hidden /></button>
  </div>;
}
