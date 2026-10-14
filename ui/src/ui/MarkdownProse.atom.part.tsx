import { MarkdownProse } from "./MarkdownProse";

export const name = "Markdown prose";
export const note = "A whole Markdown document outside a chat, with every block a reply gets";

const RICH = `The settings page fetches each setting on its own. This run moves it onto the shared store.

> [!IMPORTANT]
> Keep every setting's behaviour.

\`\`\`steps
1. List every setting
   Its type, its default, and the route the page calls today.
2. Stop for your approval
\`\`\`

\`\`\`facts
Workers: 3
Stops for you: 2
\`\`\`

\`\`\`files
src/server/settings/
  + store.ts # the shared store
  ~ routes.ts # read and write through it
\`\`\``;

export default function Rich() {
  return <MarkdownProse text={RICH} />;
}
export function Plain() {
  return <MarkdownProse text={"Split the suites between three researchers. Each reruns its suite fifty times.\n\nMerge the reports into one table, worst first."} />;
}
