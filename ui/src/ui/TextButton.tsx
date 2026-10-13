import type { ReactNode } from "react";
import "./TextButton.css";

/**
 * Atom: a quiet action inside a line of text or at the end of a row, such as
 * Pause or Open session. Drawn as words, pressed through a control-sized area.
 * Danger tone for an action that removes something.
 */
export function TextButton({ label, icon, onPress, disabled, tone, title }: {
  label: string; icon?: ReactNode; onPress: () => void; disabled?: boolean | undefined; tone?: "danger" | undefined; title?: string | undefined;
}) {
  return <button type="button" className="text-button" data-tone={tone} disabled={disabled} title={title} onClick={onPress}>{icon}{label}</button>;
}
