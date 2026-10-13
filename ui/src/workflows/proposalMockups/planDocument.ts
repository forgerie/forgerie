// Mockup only. The proposals the mockup shows, with their plans written as
// plain Markdown that uses the chat's rich blocks. An agent reads the same
// text it runs. Each `## ` section describes one stage; its heading names it.
import { PROPOSAL_STAGES, PROSE_PROPOSAL } from "../fixtures/proposals";
import type { WorkflowStage } from "../workflowsModel";

export interface PlanSection {
  /** The stage this section describes. */
  id: string;
  title: string;
  body: string;
}

export type InputName = "task" | "base" | "rounds";
export interface InputValues { task: string; base: string; rounds: number }

export interface MockProposal {
  /** The plan's `#` heading, or the workflow's name when the plan has none. */
  title: string;
  name: string;
  summary: string;
  /** The plan before its first stage. */
  overview: string;
  sections: readonly PlanSection[];
  stages: readonly WorkflowStage[];
  /** The inputs the workflow declares, in order. */
  fields: readonly InputName[];
  /** The values the agent filled. */
  proposed: InputValues;
}

// The plan does not repeat input values, so an edited input never contradicts it.
const OVERVIEW = `The settings page fetches each setting on its own. This run moves the page and its API onto the shared store. No setting changes what it does.

> [!IMPORTANT]
> Keep every setting's behaviour. If the shape needs a new setting, stop and ask first.

\`\`\`facts
Workers: 3
Stops for you: 2
Branches: 2
\`\`\``;

const SECTIONS: readonly PlanSection[] = [
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
  { id: "review", title: "Review", body: `A fresh reviewer reads both branches against the shape and sends its findings back. When the review rounds run out, the run stops and reports.

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

export const SETTINGS_PORT: MockProposal = {
  title: "Port settings to the shared store",
  name: "settings-store-port",
  summary: "Port the settings page to the shared store: agree the shape, move the API and the page in parallel, then a fresh review.",
  overview: OVERVIEW,
  sections: SECTIONS,
  stages: PROPOSAL_STAGES,
  fields: ["task", "base", "rounds"],
  proposed: { task: "Move the settings page from its own fetches to the shared store. Keep every setting's current behaviour.", base: "main", rounds: 2 },
};

/** A plan the agent wrote as prose only: no stages, no blocks, one input. */
export const FLAKY_HUNT: MockProposal = {
  title: PROSE_PROPOSAL.name,
  name: PROSE_PROPOSAL.name,
  summary: PROSE_PROPOSAL.summary,
  overview: PROSE_PROPOSAL.text,
  sections: [],
  stages: [],
  fields: ["task"],
  proposed: { task: String(PROSE_PROPOSAL.inputs.task), base: "main", rounds: 2 },
};

export const CHANGES_NOTE = "Split the review in two: one reviewer for the API branch and one for the page. Land the API first, then the page, and stop between them.";
