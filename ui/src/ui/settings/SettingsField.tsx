import type { ReactNode } from "react";

/**
 * System molecule: one property row. Label beside the value while the column has room, above it when it does not.
 * A problem shows under the value in the danger tone and marks the row, so a refused save can find it.
 */
export function SettingsField({ label, hint, problem, children, id }: { label: string; hint?: ReactNode; problem?: string | undefined; children: ReactNode; id?: string }) {
  return <div className="agent-field" data-problem={problem ? "" : undefined}>
    <span className="agent-field-label" id={id}>{label}</span>
    <div className="agent-field-value">{children}</div>
    {hint ? <p className="agent-field-hint">{hint}</p> : null}
    {problem ? <p className="agent-field-problem">{problem}</p> : null}
  </div>;
}
