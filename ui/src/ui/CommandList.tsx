import { CopyButton } from "./CopyButton";
import { MarkdownFragment } from "./MarkdownFragment";
import { parseCommands } from "./markdown/richBlockSyntax";
import "./CommandList.css";

type Labels = { copy: string; copyAll: string; all: string };
const LABELS: Labels = { copy: "Copy command", copyAll: "Copy all commands", all: "All commands" };

/**
 * System molecule: shell commands to run in order, each with its own copy
 * button and the note that says what it does. The prompt mark is drawn by CSS,
 * so it never lands in the clipboard.
 */
export function CommandList({ code, labels = LABELS }: { code: string; labels?: Labels }) {
  const commands = parseCommands(code);
  if (commands.length === 0) return null;
  const runnable = commands.filter((entry) => entry.command !== "");
  return <div className="command-list">
    <ol className="command-list-items" role="list">
      {commands.map((entry, index) => <li key={index} className="command-list-item">
        {entry.note !== "" && <div className="command-list-note"><MarkdownFragment inline text={entry.note} /></div>}
        {entry.command !== "" && <div className="command-list-row">
          <pre className="command-list-code"><code>{entry.command}</code></pre>
          <CopyButton label={labels.copy} getText={() => entry.command} />
        </div>}
      </li>)}
    </ol>
    {runnable.length > 1 && <div className="command-list-footer">
      <span className="command-list-footer-label" aria-hidden="true">{labels.all}</span>
      <CopyButton label={labels.copyAll} getText={() => runnable.map((entry) => entry.command).join("\n")} />
    </div>}
  </div>;
}
