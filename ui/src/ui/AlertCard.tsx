import type { ReactNode } from "react";
import "./AlertCard.css";

export interface AlertAction { label: string; onPress: () => void; disabled?: boolean }

/**
 * Molecule: something in the conversation went wrong and may need the
 * reader. A titled card in the failure tone with a plain explanation, the
 * code that ran, its actions, and an output panel the actions can fill.
 */
export function AlertCard({ title, time, children, code, codeLabel, actions = [], output, outputLabel, label }: {
  title: string;
  time?: string | undefined;
  /** The explanation, one or two sentences. */
  children: ReactNode;
  code?: string | undefined;
  codeLabel?: string | undefined;
  actions?: readonly AlertAction[];
  /** Text an action loaded, such as recent output. Announced when it changes. */
  output?: string | undefined;
  outputLabel?: string | undefined;
  /** Accessible name of the card. */
  label: string;
}) {
  return <section className="alert-card" aria-label={label}>
    <header className="alert-card-head">
      <span className="alert-card-dot" aria-hidden="true" />
      <h3 className="alert-card-title">{title}</h3>
      {time && <span className="alert-card-time">{time}</span>}
    </header>
    <div className="alert-card-text">{children}</div>
    {code !== undefined && <pre className="alert-card-code" tabIndex={0} aria-label={codeLabel}>{code}</pre>}
    <div aria-live="polite">
      {output !== undefined && <pre className="alert-card-output" tabIndex={0} aria-label={outputLabel}>{output}</pre>}
    </div>
    {actions.length > 0 && <div className="alert-card-actions">
      {actions.map((action, index) => <button key={action.label} type="button" className="alert-card-action"
        data-primary={index === 0 || undefined} disabled={action.disabled} onClick={action.onPress}>{action.label}</button>)}
    </div>}
  </section>;
}
