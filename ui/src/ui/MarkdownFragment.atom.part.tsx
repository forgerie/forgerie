import { MarkdownFragment } from "./MarkdownFragment";
import { MarkdownLinkContext } from "./markdown/linkScope";

export const name = "Markdown fragment";
export const note = "Short Markdown inside a block, with no outer margin";

export default function Block() {
  return <MarkdownFragment text={"Run `npm run build` first.\n\nThen read [the guide](https://example.test/guide)."} />;
}
export function Inline() {
  return <MarkdownFragment inline text="Unit tests: **1017** passed" />;
}
export function WorkspaceLinks() {
  return <MarkdownLinkContext.Provider value={{ base: "https://example.test/api/projects/p/workspaces/w/preview/" }}>
    <MarkdownFragment text="Read [the report](docs/report.html#results), [the diagram](assets/diagram.svg), and [the web guide](https://example.test/guide)." />
  </MarkdownLinkContext.Provider>;
}
