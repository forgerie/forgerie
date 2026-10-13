// Mockup only. The proposals the mockup shows. A plan is plain Markdown that
// can use the chat's rich blocks; an agent reads the same text it runs.
// `fromRecord` turns any stored proposal record into what the sheet shows.
import { PROPOSAL_STAGES, PROSE_PROPOSAL } from "../fixtures/proposals";
import { proseOf, type WorkflowProposal, type WorkflowStage } from "../workflowsModel";

/** A part of the plan. With `stage`, it describes that stage, and the route opens it. */
export interface PlanSection {
  stage?: string | undefined;
  title: string;
  body: string;
}

export interface InputSpec {
  name: string;
  type: "string" | "number" | "boolean";
  label: string;
  hint?: string | undefined;
  choices?: readonly string[] | undefined;
}

export type InputValues = Record<string, string>;

export interface MockProposal {
  /** The plan's description, or the workflow's name when it has none. */
  title: string;
  name: string;
  summary: string;
  /** The plan before its first heading. */
  overview: string;
  sections: readonly PlanSection[];
  stages: readonly WorkflowStage[];
  inputs: readonly InputSpec[];
  /** The values the agent filled. */
  proposed: InputValues;
}

/** "trial_port" and "trialPort" read as "Trial port". */
const labelOf = (name: string) => {
  const words = name.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").replace(/[_-]+/gu, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Each heading at the plan's top level starts a section. Deeper headings move up so the top level is `##`. */
function sectionsOf(prose: string, stages: readonly WorkflowStage[]): { overview: string; sections: PlanSection[] } {
  const lines = prose.split(/\r?\n/u);
  let fence = false;
  const headings: { at: number; level: number; text: string }[] = [];
  lines.forEach((line, at) => {
    if (/^\s*(```|~~~)/u.test(line)) fence = !fence;
    const match = fence ? null : /^(#{1,6})\s+(.*?)\s*#*\s*$/u.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) headings.push({ at, level: match[1].length, text: match[2] });
  });
  if (headings.length === 0) return { overview: prose, sections: [] };
  const top = Math.min(...headings.map((heading) => heading.level));
  const shift = (text: string) => text.replace(/^(#{1,6})(\s)/gmu, (_all, marks: string, space: string) => `${"#".repeat(Math.min(6, marks.length + 2 - top))}${space}`);
  const starts = headings.filter((heading) => heading.level === top);
  const find = (key: string) => stages.find((stage) => stage.id.toLowerCase() === key.toLowerCase() || stage.name.toLowerCase() === key.toLowerCase());
  const sections = starts.map((heading, index) => {
    const body = lines.slice(heading.at + 1, starts[index + 1]?.at ?? lines.length).join("\n").trim();
    // "Stage: recon (read-only)", "Recon", or "recon" each name the stage recon.
    const named = /^stage\s*:?\s*([\w-]+)(.*)$/iu.exec(heading.text);
    const stage = named?.[1] !== undefined ? find(named[1]) : find(heading.text);
    const rest = named?.[2]?.trim() ?? "";
    return { stage: stage?.id, title: stage === undefined ? heading.text : `${stage.name}${rest === "" ? "" : ` ${rest}`}`, body: shift(body) };
  });
  return { overview: shift(lines.slice(0, starts[0]?.at ?? 0).join("\n").trim()), sections };
}

/** Any stored proposal, as the sheet shows it. */
export function fromRecord(record: Pick<WorkflowProposal, "name" | "summary" | "text" | "definition" | "inputs">): MockProposal {
  const description = /^---\r?\n[\s\S]*?^description:\s*(.+)$/mu.exec(record.text)?.[1]?.trim().replace(/^["']|["']$/gu, "");
  const stages = record.definition.stages ?? [];
  const declared = Object.entries(record.definition.inputs ?? {});
  const extra = Object.keys(record.inputs).filter((name) => record.definition.inputs?.[name] === undefined);
  const inputs: InputSpec[] = [
    ...declared.map(([name, input]) => ({ name, type: input.type, label: input.description ?? labelOf(name), choices: input.choices?.map(String) })),
    ...extra.map((name) => ({ name, type: typeof record.inputs[name] === "number" ? "number" as const : "string" as const, label: labelOf(name) })),
  ].sort((a, b) => Number(b.name === "task") - Number(a.name === "task"));
  const proposed = Object.fromEntries(inputs.map(({ name }) => {
    const value = record.inputs[name] ?? record.definition.inputs?.[name]?.default;
    return [name, value === undefined ? "" : String(value)];
  }));
  return { title: description !== undefined && description.length <= 90 ? description : record.name, name: record.name, summary: record.summary,
    ...sectionsOf(proseOf(record.text), stages), stages, inputs, proposed };
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
  { stage: "shape", title: "Shape", body: `This chat writes the store's shape in \`docs/contracts/settings-store.md\`. No worker starts until you approve it.

\`\`\`steps
1. List every setting
   Its type, its default, and the route the page calls today.
2. Name who writes each setting
   The server, the page, or both.
3. Stop for your approval
\`\`\`` },
  { stage: "port", title: "Port the API and the page", body: `Two workers start at the same time, each on its own branch.

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
  { stage: "review", title: "Review", body: `A fresh reviewer reads both branches against the shape and sends its findings back. When the review rounds run out, the run stops and reports.

\`\`\`details
What the reviewer checks
- Each setting in the shape has one reader and one writer.
- No control moved on the page.
- The old routes still answer.
\`\`\`` },
  { stage: "land", title: "Land", body: `You decide when to land. Land \`api\` first, then \`page\`.

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
  inputs: [
    { name: "task", type: "string", label: "Task" },
    { name: "base", type: "string", label: "Branch to land on", choices: ["main", "next"] },
    { name: "rounds", type: "number", label: "Review rounds", hint: "The run stops and reports after this many." },
  ],
  proposed: { task: "Move the settings page from its own fetches to the shared store. Keep every setting's current behaviour.", base: "main", rounds: "2" },
};

/** A plan the agent wrote as prose only: no stages, no blocks, one input. */
export const FLAKY_HUNT: MockProposal = fromRecord(PROSE_PROPOSAL);

export const CHANGES_NOTE = "Split the review in two: one reviewer for the API branch and one for the page. Land the API first, then the page, and stop between them.";
