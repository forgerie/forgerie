import type { ReactNode } from "react";
import "./Consequence.css";

/**
 * System molecule: one short consequence the reader must see before they
 * act, set apart from the text around it by a wash and an icon. `warn` is
 * for a consequence that costs them something; the icon and the words carry
 * it, not the hue alone.
 */
export function Consequence({ icon, tone = "plain", children }: { icon: ReactNode; tone?: "plain" | "warn"; children: ReactNode }) {
  return <div className="consequence" data-tone={tone}>
    <span className="consequence-icon" aria-hidden="true">{icon}</span>
    <div className="consequence-text">{children}</div>
  </div>;
}
