import { QuoteFigure } from "./QuoteFigure";

export const name = "Quote figure";
export const note = "A quotation with its source under it";

export default function FromFile() {
  return <QuoteFigure source="AGENTS.md:58"><p>Check the thing itself, not a proxy for it. A summary is not the source.</p></QuoteFigure>;
}
export function LongSource() {
  return <QuoteFigure source="node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js:97">
    <p><code>if (appendSystemPrompt) promptSections.addendum = appendSystemPrompt;</code></p>
  </QuoteFigure>;
}
