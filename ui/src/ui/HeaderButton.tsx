import type { ReactNode } from "react";
import "./HeaderButton.css";

/**
 * Atom: a page header's one main action. The drawn button is shorter than a
 * finger; an invisible area keeps a control-sized target. With `form`, it
 * submits that form from outside it, so the header can save a page's draft.
 */
export function HeaderButton({ label, icon, form, disabled, onPress }: {
  label: string; icon?: ReactNode; form?: string | undefined; disabled?: boolean | undefined; onPress?: (() => void) | undefined;
}) {
  return <button type={form ? "submit" : "button"} form={form} className="header-button" disabled={disabled} onClick={onPress}>{icon}{label}</button>;
}
