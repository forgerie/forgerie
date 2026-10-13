// Mockup only. The settings-store-port proposal, rewritten as a plan that uses
// the chat's rich blocks. It is plain Markdown: an agent reads the same text
// it runs. Each `## ` section is one stage; its heading names the stage.

export interface PlanSection {
  /** The stage id this section describes, or "overview" for the text before the first stage. */
  id: string;
  title: string;
  body: string;
}

export const PLAN_TITLE = "Port settings to the shared store";

export const PLAN_OVERVIEW = `The settings page fetches each setting on its own. This run moves the page and its API onto the shared store. No setting changes what it does.

> [!IMPORTANT]
> Keep every setting's behaviour. If the shape needs a new setting, stop and ask first.

\`\`\`facts
Workers: 3
Stops for you: 2
Review rounds: up to 2
Lands on: main
\`\`\``;

export const PLAN_SECTIONS: readonly PlanSection[] = [
  { id: "shape", title: "Shape", body: `This chat writes the store's shape in \`docs/contracts/settings-store.md\`. No worker starts until you approve it.

\`\`\`steps
1. List every setting
   Its type, its default, and the route the page calls today.
2. Name who writes each setting
   The server, the page, or both.
3. Stop for your approval
\`\`\`` },
  { id: "port", title: "Port the API and the page", body: `Two workers start at the same time, each on its own branch.

\`\`\`files
src/server/settings/
  + store.ts # api: the shared store
  ~ routes.ts # api: read and write through the store
ui/src/settings/
  ~ SettingsPage.tsx # page: read from the store
  - useSettingFetch.ts # page: the store replaces it
\`\`\`

- \`api\` keeps the old routes answering until the page moves.
- \`page\` keeps every control where it is.` },
  { id: "review", title: "Review", body: `A fresh reviewer reads both branches against the shape. It sends its findings back once. After 2 rounds, the run stops and reports.

\`\`\`details
What the reviewer checks
- Each setting in the shape has one reader and one writer.
- No control moved on the page.
- The old routes still answer.
\`\`\`` },
  { id: "land", title: "Land", body: `You decide when to land. Land \`api\` first, then \`page\`.

> [!WARNING]
> If \`page\` lands before \`api\`, the settings page cannot load until \`api\` lands.` },
];
