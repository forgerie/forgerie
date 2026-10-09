import type { ReactNode } from "react";
import "./ActionCard.css";
export function ActionCard({ title, detail, children, actions }: {
  title: string; detail?: string | undefined; children?: ReactNode;
  actions: readonly { label: string; disabled?: boolean | undefined; onPress: () => void }[];
}) {
  return <section className="action-card"><h3 className="action-card-title">{title}</h3>
    {detail && <p className="action-card-detail">{detail}</p>}{children}
    <div className="action-card-actions">{actions.map((action) => <button type="button" className="action-card-button" key={action.label} disabled={action.disabled} onClick={action.onPress}>{action.label}</button>)}</div>
  </section>;
}
