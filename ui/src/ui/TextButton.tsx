import type { ReactNode } from "react";
import "./TextButton.css";

/**
 * Atom: a quiet action inside a line of text or at the end of a row, such as
 * Pause or Open session. Drawn as words, pressed through a control-sized area.
 * Danger tone for an action that removes something. With `pressed`, it is a
 * toggle, and a pressed one keeps the active wash.
 */
export function TextButton({ label, icon, onPress, disabled, tone, title, pressed }: {
  label: string; icon?: ReactNode; onPress: () => void; disabled?: boolean | undefined; tone?: "danger" | undefined; title?: string | undefined;
  /** Set to make the button a toggle: true while what it opened is open. */
  pressed?: boolean | undefined;
}) {
  return <button type="button" className="text-button" data-tone={tone} disabled={disabled} title={title} aria-pressed={pressed} onClick={onPress}>{icon}{label}</button>;
}
