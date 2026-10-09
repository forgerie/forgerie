import type { ReactNode } from "react";
import "./BadgeButton.css";

/**
 * Atom: an icon button drawn small with a control-sized hit area. A count
 * badge in the live colour says how many things wait on the reader; a dot
 * says that something is working. The label carries both for a screen reader.
 */
export function BadgeButton({ icon, label, count = 0, active = false, onPress }: {
  icon: ReactNode;
  /** The accessible name and hover text, including what the badge and dot mean. */
  label: string;
  count?: number;
  active?: boolean;
  onPress: () => void;
}) {
  return <button type="button" className="badge-button" aria-label={label} title={label} onClick={onPress}
    data-waiting={count > 0 || undefined} data-active={active || undefined}>
    {icon}
    {count > 0 ? <span className="badge-button-count" aria-hidden>{count}</span>
      : active ? <span className="badge-button-dot" aria-hidden /> : null}
  </button>;
}
