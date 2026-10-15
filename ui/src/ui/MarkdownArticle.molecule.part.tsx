import { MarkdownArticle } from "./MarkdownArticle";

export const name = "Markdown article";
export const note = "A whole Markdown document by another author, under a titled head with its source";

const text = [
  "Keeps a long-running goal in view across sessions.",
  "",
  "## Install",
  "",
  "```sh",
  "pi install npm:pi-goal",
  "```",
  "",
  "## Settings",
  "",
  "| Setting | Default | What it does |",
  "| --- | --- | --- |",
  "| `goal.reminder` | `true` | Repeats the goal at the start of each turn. |",
  "| `goal.limit` | `3` | How many goals stay open at once. |",
  "",
  "<details><summary>Why a goal?</summary>",
  "",
  "A goal is a sentence the agent rereads, so a long task does not drift.",
  "",
  "</details>",
].join("\n");

export default function Ready() {
  return <MarkdownArticle title="Readme" source={{ label: "README.md", href: "https://example.com/README.md" }} text={text} />;
}
export function NoSourcePage() {
  return <MarkdownArticle title="Readme" source={{ label: "README.md" }} text={text} />;
}
export function CutShort() {
  return <MarkdownArticle title="Readme" source={{ label: "README.md" }} text={text} note="The document is longer than this page shows." />;
}
export function Problem() {
  return <MarkdownArticle title="Readme" text="" problem="The document could not be read: the file is not readable." />;
}
