import { EyeIcon } from "lucide-react";
import "./WatchToggle.css";

/**
 * Atom: a switch that says whether something is being watched, as a small
 * pressed button with an eye. While on, the eye takes the live colour and a
 * count can ride beside the word. Its accessible name starts with the words
 * it shows, then names the count and what is watched. The hit area is
 * control-sized whatever the drawn size.
 */
export function WatchToggle({ on, text, what, count, countText, disabled = false, onPress }: {
  on: boolean;
  /** The visible word, such as the state it would change to or the state it is in. */
  text: string;
  /** What is watched, for a screen reader and hover, such as the run and its number. */
  what?: string | undefined;
  /** How often the watch fired. Drawn only while it is on and above zero. */
  count?: number | undefined;
  /** The count's unit in words, read after it, such as "wakes". */
  countText?: string | undefined;
  disabled?: boolean;
  onPress: () => void;
}) {
  const counted = on && count !== undefined && count > 0;
  const name = `${text}${counted ? ` ${String(count)}${countText ? ` ${countText}` : ""}` : ""}${what ? `, ${what}` : ""}`;
  return <button type="button" className="watch-toggle" aria-pressed={on} title={name} disabled={disabled} onClick={onPress}>
    <EyeIcon aria-hidden className="watch-toggle-icon" />
    <span className="watch-toggle-text">{text}</span>
    {counted ? <span className="watch-toggle-count">{count}</span> : null}
    {counted && countText ? <span className="watch-toggle-hidden"> {countText}</span> : null}
    {what ? <span className="watch-toggle-hidden">, {what}</span> : null}
  </button>;
}
