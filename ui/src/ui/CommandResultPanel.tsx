import type { CommandResult } from "../commands";

export interface CommandResultBinding {
  result: CommandResult;
  disabled: boolean;
  onChoose: (requestId: string, value: string) => void;
  onClose: () => void;
}

/** Shape: feedback and follow-up choices from Pi, separate from transcript history. `/tree` opens its own navigator. */
export function CommandResultPanel({ result, disabled, onChoose, onClose }: CommandResultBinding) {
  if (result.type === "done" && !result.message || result.type === "unsupported" || result.type === "tree") return null;
  return <section className="command-result" aria-label="Command result">
    <div className="command-result-head">
      {result.type === "select" ? <h2>{result.title}</h2> : <span>Pi command</span>}
      <button type="button" onClick={onClose} disabled={disabled}>Close</button>
    </div>
    <div className="command-result-body">
      {result.type === "done" && <p role="status">{result.message}</p>}
      {result.type === "select" && result.options.map((option) => <button type="button" key={option.value}
        className="command-option" disabled={disabled} onClick={() => onChoose(result.requestId, option.value)}>
        <span>{option.label}</span>{option.description && <small>{option.description}</small>}
      </button>)}
    </div>
  </section>;
}
