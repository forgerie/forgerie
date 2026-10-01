import { useLayoutEffect, useRef } from "react";
import type { ShellResult, ShellRun as Run } from "../shellRun";
import { CopyButton } from "./CopyButton";

type Status = { label: string; tone?: "error"; live?: boolean };
function statusOf(result: ShellResult): Status {
  switch (result.type) {
    case "running": return { label: "running", live: true };
    case "failed": return { label: "failed", tone: "error" };
    case "interrupted": return { label: "no result" };
    case "done": return result.cancelled ? { label: "cancelled" }
      : result.exitCode === undefined ? { label: "done" }
      : { label: `exit ${result.exitCode}`, ...(result.exitCode === 0 ? {} : { tone: "error" as const }) };
  }
}

/**
 * Shape: one `!` command as a code sheet. The command stays visible; only the
 * output scrolls inside its height budget. While the command runs, the output
 * follows its newest line unless the reader scrolled away from the end.
 */
export function ShellRun({ run }: { run: Run }) {
  const { result } = run;
  const status = statusOf(result);
  const output = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    if (result.type === "running" && following.current && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [result]);
  const onScroll = () => {
    const node = output.current;
    if (node) following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 8;
  };
  const empty = result.type === "running" ? "Waiting for output." : result.type === "failed" ? "" : "No output.";
  return <section className="shell-run" aria-label={`Shell command ${run.command ?? ""}`.trim()}>
    <div className="shell-header">
      <span className="shell-label">shell</span>
      <span className="shell-readouts">
        {run.excludeFromContext && <span className="shell-context" title="The agent does not see this output">excluded from context</span>}
        <span className="shell-status" role="status" data-tone={status.tone} data-live={status.live || undefined}>{status.label}</span>
      </span>
      <CopyButton label="Copy output" getText={() => result.output} />
    </div>
    <div className="shell-body">
      <p className="shell-command"><span className="shell-prompt" aria-hidden>$ </span>
        {run.command ?? <span className="shell-unknown">Started before this page connected.</span>}</p>
      {result.output ? <pre ref={output} className="shell-output" tabIndex={0} onScroll={onScroll}>{result.output}</pre>
        : empty ? <p className="shell-empty">{empty}</p> : null}
      {result.type === "failed" && <p className="shell-error" role="alert">{result.error}</p>}
    </div>
    <ShellNotes result={result} />
  </section>;
}

function ShellNotes({ result }: { result: ShellResult }) {
  const notes = [
    result.type === "running" && result.clipped ? "Older output is not shown." : "",
    result.type === "interrupted" ? "The result did not arrive. Reload to see the saved result." : "",
    result.type === "done" && result.truncated ? `Output truncated.${result.fullOutputPath ? ` Full output: ${result.fullOutputPath}` : ""}` : "",
  ].filter(Boolean);
  return notes.length > 0 ? <div className="shell-notes">{notes.map((note) => <p key={note}>{note}</p>)}</div> : null;
}
