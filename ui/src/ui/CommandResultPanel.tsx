import type { CommandResult } from "../commands";

export interface CommandResultBinding {
  result: CommandResult;
  disabled: boolean;
  onChoose: (requestId: string, value: string) => void;
  onClose: () => void;
}

/** Shape: feedback and follow-up choices from Pi, separate from transcript history. */
export function CommandResultPanel({ result, disabled, onChoose, onClose }: CommandResultBinding) {
  if (result.type === "done" && !result.message || result.type === "unsupported") return null;
  return <section className="command-result" aria-label="Command result">
    <div className="command-result-head">
      {result.type === "select" ? <h2>{result.title}</h2> : <span>{result.type === "tree" ? "Session tree (read-only)" : "Pi command"}</span>}
      <button type="button" onClick={onClose} disabled={disabled}>Close</button>
    </div>
    <div className="command-result-body">
      {result.type === "done" && <p role="status">{result.message}</p>}
      {result.type === "select" && result.options.map((option) => <button type="button" key={option.value}
        className="command-option" disabled={disabled} onClick={() => onChoose(result.requestId, option.value)}>
        <span>{option.label}</span>{option.description && <small>{option.description}</small>}
      </button>)}
      {result.type === "tree" && <>
        <p>To navigate or fork from this tree, use the current Forgerie client. This MVP only displays it.</p>
        <ol className="command-tree">{result.tree.nodes.map((node) => <li key={node.id}
          aria-current={node.id === result.tree.activeLeafId ? "step" : undefined}>
          <small>{node.kind}{node.id === result.tree.activeLeafId ? ", current" : ""}</small> {node.summary}
        </li>)}</ol>
      </>}
    </div>
  </section>;
}
