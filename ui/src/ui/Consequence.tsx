import type { ReactNode } from "react";
import { TextButton } from "./TextButton";
import "./Consequence.css";

/** A quiet next step under a consequence. */
export interface ConsequenceAction { label: string; onPress: () => void }

/**
 * System molecule: one short consequence the reader must see before they
 * act, set apart from the text around it by a wash and an icon. `warn` is
 * for a consequence that costs them something; the icon and the words carry
 * it, not the hue alone. Quiet next steps can follow the words; they wrap.
 */
export function Consequence({ icon, tone = "plain", actions, children }: {
  icon: ReactNode; tone?: "plain" | "warn"; actions?: readonly ConsequenceAction[] | undefined; children: ReactNode;
}) {
  return <div className="consequence" data-tone={tone}>
    <span className="consequence-icon" aria-hidden="true">{icon}</span>
    <div className="consequence-text">
      {children}
      {actions?.length ? <div className="consequence-actions">{actions.map((action) => <TextButton key={action.label} label={action.label} onPress={action.onPress} />)}</div> : null}
    </div>
  </div>;
}
