import { TagList } from "./TagList";

export const name = "Tag list";
export const note = "Short words that classify something, as quiet pills that wrap";

export default function Few() {
  return <TagList label="Labels" tags={["bug", "priority: high"]} />;
}
export function Many() {
  return <TagList label="Labels" tags={["bug", "priority: medium", "ui", "fold-postures", "accessibility", "good first issue", "needs-design",
    "parking-lot", "area: transcript", "area: composer", "regression", "help wanted"]} />;
}
export function LongTag() {
  return <TagList label="Labels" tags={["area: transcript-rendering-and-system-message-artifacts-for-github-proposals", "ui"]} />;
}
