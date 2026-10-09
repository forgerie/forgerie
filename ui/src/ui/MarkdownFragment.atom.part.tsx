import { MarkdownFragment } from "./MarkdownFragment";

export const name = "Markdown fragment";
export const note = "Short Markdown inside a block, with no outer margin";

export default function Block() {
  return <MarkdownFragment text={"Run `npm run build` first.\n\nThen read [the guide](https://example.test/guide)."} />;
}
export function Inline() {
  return <MarkdownFragment inline text="Unit tests: **1017** passed" />;
}
