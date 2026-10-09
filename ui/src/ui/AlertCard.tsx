import { useId, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import "./AlertCard.css";

export interface AlertAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Set when the action shows and hides the output panel: it then draws as a disclosure. */
  expanded?: boolean;
}

/**
 * Molecule: something in the conversation went wrong and may need the
 * reader. The trace's rail and wash in the failure tone, holding a subject,
 * what happened, a plain explanation, the code that ran, quiet actions, and
 * an output panel the actions can fill.
 */
export function AlertCard({ subject, title, time, children, code, codeLabel, actions = [], output, outputLabel, label }: {
  /** The thing that failed, in the code face, such as a process name. */
  subject?: string | undefined;
  /** What happened. With a subject, a few words after it, such as "failed". */
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
  const outputId = useId();
  return <section className="alert-card" aria-label={label}>
    <header className="alert-card-head">
      <h3 className="alert-card-title" data-phrase={subject !== undefined || undefined}>
        {subject !== undefined && <span className="alert-card-subject">{subject}</span>}
        {subject !== undefined && " "}{title}
      </h3>
      {time && <span className="alert-card-time">{time}</span>}
    </header>
    <div className="alert-card-text">{children}</div>
    {code !== undefined && <pre className="alert-card-code" tabIndex={0} aria-label={codeLabel}>{code}</pre>}
    {actions.length > 0 && <div className="alert-card-actions">
      {actions.map((action) => <button key={action.label} type="button" className="alert-card-action"
        aria-expanded={action.expanded} aria-controls={action.expanded === undefined ? undefined : outputId}
        disabled={action.disabled} onClick={action.onPress}>
        {action.expanded !== undefined && <ChevronRightIcon className="alert-card-marker" aria-hidden="true" />}
        {action.label}
      </button>)}
    </div>}
    <div id={outputId} aria-live="polite">
      {output !== undefined && <pre className="alert-card-output" tabIndex={0} aria-label={outputLabel}>{output}</pre>}
    </div>
  </section>;
}
