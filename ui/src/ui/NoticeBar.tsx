import "./NoticeBar.css";

export interface NoticeAction { label: string; onPress: () => void; primary?: boolean }

/**
 * Molecule: a full-width bar that stops the reader until they choose: a
 * message and its actions. The alert tone marks a failure or a risk to their
 * work; the plain tone asks a question. Actions wrap under the message when
 * the bar is narrow.
 */
export function NoticeBar({ tone = "plain", message, actions }: {
  tone?: "alert" | "plain";
  message: string;
  actions: readonly NoticeAction[];
}) {
  return <div className="notice-bar" data-tone={tone} role="alert">
    <p className="notice-bar-text">{message}</p>
    <div className="notice-bar-actions">
      {actions.map((action) => <button key={action.label} type="button" className="notice-bar-action" data-primary={action.primary || undefined}
        onClick={action.onPress}>{action.label}</button>)}
    </div>
  </div>;
}
