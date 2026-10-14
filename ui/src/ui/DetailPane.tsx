import type { ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";
import "./DetailPane.css";

/**
 * Molecule: one item opened in a pane: a way back, its title and status with its actions, an optional bar of
 * settings, a body that scrolls on its own, and a foot, such as a box to reply, that stays in view. The pane fills
 * the height it gets; nothing but the body scrolls.
 */
export function DetailPane({ back, title, status, actions, bar, label, children, foot }: {
  back: { label: string; onPress: () => void };
  title: ReactNode;
  status?: ReactNode;
  /** Controls at the header's end, such as Stop. */
  actions?: ReactNode;
  bar?: ReactNode;
  /** Accessible name of the scrolling body. */
  label: string;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return <div className="detail-pane">
    <header className="detail-pane-head">
      <button type="button" className="detail-pane-back" onClick={back.onPress}><ArrowLeftIcon aria-hidden />{back.label}</button>
      <div className="detail-pane-titles">
        <h3 className="detail-pane-title">{title}</h3>
        {status !== undefined && status !== null && <p className="detail-pane-status">{status}</p>}
      </div>
      {actions !== undefined && actions !== null && <div className="detail-pane-actions">{actions}</div>}
    </header>
    {bar !== undefined && bar !== null && <div className="detail-pane-bar">{bar}</div>}
    <div className="detail-pane-body" tabIndex={0} role="region" aria-label={label}>{children}</div>
    {foot !== undefined && foot !== null && <div className="detail-pane-foot">{foot}</div>}
  </div>;
}
