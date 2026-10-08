import type { ReactNode } from "react";

/** System molecule: one property row. Label beside the value while the column has room, above it when it does not. */
export function SettingsField({ label, hint, children, id }: { label: string; hint?: ReactNode; children: ReactNode; id?: string }) {
  return <div className="agent-field">
    <span className="agent-field-label" id={id}>{label}</span>
    <div className="agent-field-value">{children}</div>
    {hint ? <p className="agent-field-hint">{hint}</p> : null}
  </div>;
}
