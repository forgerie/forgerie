import { MarkdownFragment } from "../ui/MarkdownFragment";
import { MarkdownProse } from "../ui/MarkdownProse";
import { NumberedSections, type NumberedSection } from "../ui/NumberedSections";
import type { StageProgress } from "./workflowLive";
import type { PlanDocument } from "./workflowPlan";
import type { RouteChange } from "./workflowRoute";
import type { WorkflowStage } from "./workflowsModel";

/**
 * Shape: a workflow's plan as a document: its overview, then one section per heading, in the chat's own blocks. A
 * stage's section carries the stage's number in the reader's route. Before the plan catches up with the reader's
 * route, a removed stage's section stays, struck; an added stage gets a section the agent will write; a stage that
 * gained or lost a worker says so. During a run, the stages done and the stage at work are marked.
 */
export function WorkflowPlan({ plan, original, stages = original, changes = [], progress, target, onInView }: {
  plan: PlanDocument;
  /** The route the plan was written for. */
  original: readonly WorkflowStage[];
  /** The reader's route, which numbers the sections. */
  stages?: readonly WorkflowStage[];
  changes?: readonly RouteChange[];
  progress?: Readonly<Record<string, StageProgress>> | undefined;
  /** The stage whose section to bring into view. */
  target?: { stage: string; at: number } | undefined;
  onInView?: ((stage: string | undefined) => void) | undefined;
}) {
  const numberOf = (id: string | undefined) => { const at = id === undefined ? -1 : stages.findIndex((stage) => stage.id === id); return at < 0 ? undefined : at + 1; };
  const added = stages.filter((stage) => !original.some((s) => s.id === stage.id));
  // A new stage's section follows the section of the stage before it in the reader's route, and new stages chain.
  const chainAfter = (id: string | undefined): WorkflowStage[] => added.filter((stage) => stages[stages.indexOf(stage) - 1]?.id === id)
    .flatMap((stage) => [stage, ...chainAfter(stage.id)]);
  const placeholder = (stage: WorkflowStage): NumberedSection => ({ key: `stage:${stage.id}`, number: numberOf(stage.id), title: stage.name, change: "added",
    body: `${stage.does === undefined ? "" : `${stage.does} `}The agent writes this section when it updates the plan.` });
  const firstStage = plan.sections.findIndex((section) => section.stage !== undefined);
  const sections = plan.sections.flatMap((section, index): NumberedSection[] => {
    const number = numberOf(section.stage);
    const removed = section.stage !== undefined && number === undefined;
    const workers = changes.filter((change) => change.stage === section.stage && (change.kind === "add-worker" || change.kind === "remove-worker"));
    const state = section.stage === undefined ? undefined : progress?.[section.stage];
    const own: NumberedSection = {
      key: section.stage === undefined ? `section:${String(index)}` : `stage:${section.stage}`, number,
      title: <MarkdownFragment inline text={section.title} />,
      mark: state === "done" ? "done" : state === "current" || state === "waiting" ? "current" : undefined,
      change: removed ? "removed" : undefined,
      flag: removed ? "You removed this stage. The agent takes it out when it updates the plan."
        : workers.length > 0 ? `${workers.map((change) => `${change.kind === "add-worker" ? "+" : "−"} ${"worker" in change ? change.worker : ""}`).join(", ")}. The agent updates this section to match.`
        : undefined,
      body: <MarkdownProse text={section.body} />,
    };
    return [...index === firstStage ? chainAfter(undefined).map(placeholder) : [], own,
      ...section.stage === undefined || removed ? [] : chainAfter(section.stage).map(placeholder)];
  });
  // A new stage whose neighbour has no section of its own goes last, so every added stage shows.
  const all = [...sections, ...added.filter((stage) => !sections.some((section) => section.key === `stage:${stage.id}`)).map(placeholder)];
  return <NumberedSections overview={plan.overview === "" ? undefined : <MarkdownProse text={plan.overview} />} sections={all}
    target={target === undefined ? undefined : { key: `stage:${target.stage}`, at: target.at }}
    onInView={onInView === undefined ? undefined : (key) => onInView(key?.startsWith("stage:") ? key.slice("stage:".length) : undefined)} />;
}
