// Target projects in words: the project row's chip and hint, the list row's summary, why a workflow is not
// common to the target projects, and each project's outcome in a fire. Pure. Project names come from the caller.
import { triggerFireSummary, type TriggerFire, type TriggerProjectFire, type TriggerTargets, type TriggerWorkflow, type TriggerWorkflowsResponse } from "@shared/triggers";

type Diagnostics = readonly TriggerWorkflowsResponse["diagnostics"][number][];
/** What the common-workflow read answers. */
interface Common { workflows: readonly TriggerWorkflow[]; diagnostics: Diagnostics }

/** A project's name for a cwd, as the session list names it. */
export type ProjectName = (cwd: string) => string;

/** The fixed cwds, or none for All projects. */
export const fixedCwds = (targets: TriggerTargets): readonly string[] => targets.kind === "projects" ? targets.cwds : [];
/** At least one project, or All projects. */
export const hasTargets = (targets: TriggerTargets) => targets.kind === "all" || targets.cwds.length > 0;
/** One key per selection, whatever order the projects were checked in. */
export const targetsKey = (targets: TriggerTargets) => targets.kind === "all" ? "all" : [...targets.cwds].sort().join("\n");
/** More than one project: the fire has one outcome per project, and Run now can pick one. */
export const isSpread = (targets: TriggerTargets) => targets.kind === "all" || targets.cwds.length > 1;

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;
export const listWords = (items: readonly string[]) => items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1) ?? ""}`;
/** "forgerie, pi-mono, and 3 more": a list that stays short. */
export function shortList(items: readonly string[], keep = 3): string {
  return items.length <= keep + 1 ? listWords(items) : `${items.slice(0, keep).join(", ")}, and ${String(items.length - keep)} more`;
}

/** The chip after "Runs in": "forgerie", "3 projects", "all projects"; undefined while nothing is chosen. */
export function targetChip(targets: TriggerTargets, name: ProjectName): string | undefined {
  if (targets.kind === "all") return "all projects";
  if (targets.cwds.length === 0) return undefined;
  return targets.cwds.length === 1 ? name(targets.cwds[0] ?? "") : plural(targets.cwds.length, "project");
}
/** The list row's words: "forgerie", "3 projects", "All projects". */
export function targetSummary(targets: TriggerTargets, name: ProjectName): string {
  return targets.kind === "all" ? "All projects" : targetChip(targets, name) ?? "No project";
}
/** Every project name, for a tooltip and the list's filter. */
export function targetNames(targets: TriggerTargets, name: ProjectName): string {
  return targets.kind === "all" ? "All projects, including projects added later" : targets.cwds.map(name).join(", ");
}
/** The project row's hint: what one fire starts. */
export function targetHint(targets: TriggerTargets): string {
  if (targets.kind === "all") return "Each run starts a new session in every project, at once. Projects added later are included.";
  if (targets.cwds.length > 1) return "Each run starts a new session in each of these projects, at once.";
  return "Each run starts a new session in this folder.";
}

/** Structured common-workflow diagnostics name projects without parsing paths out of prose. */
type Gap = { kind: "missing" | "script" | "inputs"; cwds: readonly string[] } | { kind: "other"; cwds: readonly string[]; error: string };
function gapOf(diagnostic: TriggerWorkflowsResponse["diagnostics"][number]): Gap {
  if (diagnostic.reason) {
    const cwds = diagnostic.cwds ?? [diagnostic.path];
    switch (diagnostic.reason) {
      case "missing": return { kind: "missing", cwds };
      case "script": return { kind: "script", cwds };
      case "inputs-differ": return { kind: "inputs", cwds };
      case "unreadable": return { kind: "other", cwds, error: diagnostic.error };
    }
  }
  // Legacy per-cwd diagnostics have no reason or cwds.
  const between = /^Workflow input declarations differ between (\/.*?) and (\/.*)$/u.exec(diagnostic.error);
  if (between) return { kind: "inputs", cwds: [between[1] ?? "", between[2] ?? ""] };
  const found = /^Workflow (is unavailable|must resolve to prose) in (.+)$/u.exec(diagnostic.error);
  if (!found) return { kind: "other", cwds: [diagnostic.path], error: diagnostic.error };
  return { kind: found[1] === "is unavailable" ? "missing" : "script", cwds: [found[2] ?? diagnostic.path] };
}
const firstLine = (text: string) => text.split("\n").map((line) => line.trim()).find(Boolean) ?? text.trim();
const gapsFor = (workflow: string, diagnostics: Diagnostics): Gap[] => diagnostics.filter((item) => item.name === workflow).map(gapOf);
/** The projects a kind of gap names: for inputs, every project in a pair that differs, the shared one first. */
function gapProjects(gaps: readonly Gap[], kind: Gap["kind"], name: ProjectName): string[] {
  return [...new Set(gaps.flatMap((gap) => gap.kind !== kind ? [] : gap.cwds).map(name))];
}

/** Why a workflow is not offered, in a few words: "Missing in pi-mono", "Inputs differ between forgerie and caliper". */
export function gapShort(workflow: string, diagnostics: Diagnostics, name: ProjectName): string | undefined {
  const gaps = gapsFor(workflow, diagnostics);
  if (gaps.length === 0) return undefined;
  const where = (kind: Gap["kind"]) => shortList(gapProjects(gaps, kind, name), 2);
  const parts = [
    gaps.some((gap) => gap.kind === "missing") ? `Missing in ${where("missing")}` : undefined,
    gaps.some((gap) => gap.kind === "inputs") ? `Inputs differ between ${where("inputs")}` : undefined,
    gaps.some((gap) => gap.kind === "script") ? `A script in ${where("script")}` : undefined,
    gaps.some((gap) => gap.kind === "other") ? `Cannot be read in ${where("other")}` : undefined,
  ].filter(Boolean);
  return parts.join(". ");
}

/**
 * Why the chosen workflow cannot run in every target project, from the common-workflow read's diagnostics.
 * Undefined while it is common.
 */
export function workflowGap(workflow: string, common: Common, name: ProjectName): string | undefined {
  if (!workflow || common.workflows.some((item) => item.name === workflow)) return undefined;
  const gaps = gapsFor(workflow, common.diagnostics);
  const unread = common.diagnostics.filter((item) => item.name === "").flatMap((item) => gapOf(item).cwds.map(name));
  const where = (kind: Gap["kind"]) => listWords(gapProjects(gaps, kind, name));
  const reasons = [
    gaps.some((gap) => gap.kind === "missing") ? `It is missing in ${where("missing")}.` : undefined,
    gaps.some((gap) => gap.kind === "inputs") ? `Its inputs differ between ${where("inputs")}.` : undefined,
    gaps.some((gap) => gap.kind === "script") ? `It is a script in ${where("script")}, and scripts cannot run on a schedule.` : undefined,
    ...gaps.flatMap((gap) => gap.kind === "other" ? [`${listWords(gap.cwds.map(name))}: ${firstLine(gap.error)}`] : []),
    gaps.length === 0 && unread.length > 0 ? `Forgerie could not read ${listWords([...new Set(unread)])}.` : undefined,
  ].filter(Boolean);
  return [`“${workflow}” cannot run in every target project.`, ...reasons.length ? reasons : ["No target project has it."],
    "Choose another workflow, or change the projects."].join(" ");
}

/** A project's outcome in one word or two. */
export const PROJECT_STATUS: Record<TriggerProjectFire["outcome"]["kind"], string> = {
  started: "Started", failed: "Failed", unavailable: "Unavailable", running: "Starting…", missed: "Missed",
};
const ORDER: Record<TriggerProjectFire["outcome"]["kind"], number> = { failed: 0, running: 1, missed: 2, started: 3, unavailable: 4 };
/** Failures first, unavailable projects last: the order a reader acts in. Stable within each kind. */
export function projectsInOrder(projectFires: readonly TriggerProjectFire[]): TriggerProjectFire[] {
  return projectFires.map((item, index) => ({ item, index })).sort((a, b) => ORDER[a.item.outcome.kind] - ORDER[b.item.outcome.kind] || a.index - b.index)
    .map(({ item }) => item);
}
/** A fire that ran in more than one project shows a count and one line per project. One project looks as before. */
export const isSpreadFire = (fire: Pick<TriggerFire, "projects">) => fire.projects.length > 1;

/** "4 of 5 started, 1 failed, 1 unavailable": a spread fire in numbers. */
export function fireCountWords(fire: Pick<TriggerFire, "projects">): string {
  const summary = triggerFireSummary(fire);
  if (summary.running > 0) {
    const settled = ([["failed", summary.failed], ["unavailable", summary.unavailable]] as const).filter(([, count]) => count > 0)
      .map(([word, count]) => `${String(count)} ${word}`);
    return [`${String(summary.started)} of ${String(summary.total)} started`, ...settled, `${String(summary.running)} still starting`].join(", ");
  }
  if (summary.missed === summary.total) return "missed";
  const rest = ([["failed", summary.failed], ["unavailable", summary.unavailable], ["missed", summary.missed]] as const)
    .filter(([, count]) => count > 0).map(([word, count]) => `${String(count)} ${word}`);
  return [`${String(summary.started)} of ${String(summary.total)} started`, ...rest].join(", ");
}
