import type { ReactNode } from "react";
import "./HeaderButton.css";

/**
 * Atom: a page header's one main action. The drawn button is shorter than a
 * finger; an invisible area keeps a control-sized target. With `form`, it
 * submits that form from outside it, so the header can save a page's draft.
 * `plain` draws a second action beside the main one with a hairline instead
 * of the fill, so the header still asks for one thing.
 */
export function HeaderButton({ label, icon, form, disabled, tone = "primary", onPress }: {
  label: string; icon?: ReactNode; form?: string | undefined; disabled?: boolean | undefined; tone?: "primary" | "plain" | undefined; onPress?: (() => void) | undefined;
}) {
  return <button type={form ? "submit" : "button"} form={form} className="header-button" data-tone={tone === "plain" ? tone : undefined} disabled={disabled}
    onClick={onPress}>{icon}{label}</button>;
}
