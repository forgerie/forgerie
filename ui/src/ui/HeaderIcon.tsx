import type { ReactNode } from "react";
import "./HeaderIcon.css";

/**
 * Atom: an icon-only control in a page header, such as Close. Drawn at the
 * icon size in the muted ink, pressed through a control-sized area; its
 * label is its accessible name and its tooltip.
 */
export function HeaderIcon({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  return <button type="button" className="header-icon" aria-label={label} title={label} onClick={onPress}>{icon}</button>;
}
