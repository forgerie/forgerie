import { MarkdownSurface } from "./MarkdownSurface";

export const name = "Markdown surface";
export const note = "Gives rendered Markdown the transcript's type";

export default function Prose() {
  return <MarkdownSurface>
    <h2>A heading in the reply's face</h2>
    <p>A paragraph with a <a href="https://example.com">link</a>, <strong>strong text</strong> and <code>inline code</code>.</p>
    <ul><li>A list item</li><li>Another list item</li></ul>
    <blockquote><p>A quotation, set apart.</p></blockquote>
  </MarkdownSurface>;
}
