import { Undo2Icon } from "lucide-react";
import { MarkdownFragment } from "./MarkdownFragment";
import { parseCorrection } from "./markdown/richBlockSyntax";
import "./CorrectionPanel.css";

type Labels = { title: string; wrong: string; right: string; cause: string };
const LABELS: Labels = { title: "Correction", wrong: "Earlier", right: "Correct", cause: "Cause" };

/**
 * System molecule: a correction to something said earlier. It is the loudest
 * block on purpose: what was wrong is struck through, what is true is strong,
 * and the cause is stated, so a reader who skims still sees the change.
 */
export function CorrectionPanel({ code, labels = LABELS }: { code: string; labels?: Labels }) {
  const { wrong, right, cause } = parseCorrection(code);
  if (wrong === "" && right === "" && cause === "") return null;
  return <section className="correction-panel" role="note" aria-label={labels.title}>
    <div className="correction-panel-title"><Undo2Icon className="correction-panel-icon" aria-hidden="true" />{labels.title}</div>
    <dl className="correction-panel-fields">
      {wrong !== "" && <div className="correction-panel-field" data-field="wrong">
        <dt className="correction-panel-label">{labels.wrong}</dt>
        <dd className="correction-panel-value"><del className="correction-panel-struck"><MarkdownFragment text={wrong} /></del></dd>
      </div>}
      {right !== "" && <div className="correction-panel-field" data-field="right">
        <dt className="correction-panel-label">{labels.right}</dt>
        <dd className="correction-panel-value"><MarkdownFragment text={right} /></dd>
      </div>}
      {cause !== "" && <div className="correction-panel-field" data-field="cause">
        <dt className="correction-panel-label">{labels.cause}</dt>
        <dd className="correction-panel-value"><MarkdownFragment text={cause} /></dd>
      </div>}
    </dl>
  </section>;
}
