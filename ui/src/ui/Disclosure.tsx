import { ChevronRightIcon } from "lucide-react";
import { MarkdownFragment } from "./MarkdownFragment";
import { parseDisclosure } from "./markdown/richBlockSyntax";
import "./Disclosure.css";

/**
 * System molecule: supporting material behind a one-line summary, closed by
 * default. The element is uncontrolled, so a reader who opens it keeps it
 * open while the rest of the reply streams in.
 */
export function Disclosure({ code }: { code: string }) {
  const { summary, body } = parseDisclosure(code);
  if (summary === "") return null;
  return <details className="disclosure">
    <summary className="disclosure-summary">
      <ChevronRightIcon className="disclosure-marker" aria-hidden="true" />
      <span className="disclosure-title">{summary}</span>
    </summary>
    {body !== "" && <div className="disclosure-body"><MarkdownFragment text={body} /></div>}
  </details>;
}
