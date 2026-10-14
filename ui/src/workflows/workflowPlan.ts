// A workflow's prose as the sheet's plan pane shows it: an overview, then one section per top-level heading. A section
// whose heading names a stage belongs to that stage, so the route can open it and the run can mark it.
import { proseOf, type WorkflowStage } from "./workflowsModel";

/** A part of the plan. With `stage`, it describes that stage. */
export interface PlanSection {
  stage?: string | undefined;
  /** The heading's text, as inline Markdown. */
  title: string;
  /** The section without its heading. Its own headings sit one level under the section's. */
  body: string;
}

export interface PlanDocument {
  /** The prose before the first heading. */
  overview: string;
  sections: readonly PlanSection[];
}

/** A title longer than this reads as a paragraph, so the sheet's header keeps the workflow's name instead. */
const TITLE_LENGTH = 90;

/** The frontmatter's description, when it is short enough to be a title. */
export function planTitle(text: string, name: string): string {
  const description = /^---\r?\n[\s\S]*?^description:\s*(.+)$/mu.exec(text)?.[1]?.trim().replace(/^["']|["']$/gu, "");
  return description !== undefined && description !== "" && description.length <= TITLE_LENGTH ? description : name;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/u;
const FENCE = /^\s*(```|~~~)/u;

/**
 * The plan in sections. Each heading at the prose's top level starts one; the deeper headings in it move up so that
 * the section's own heading is the second level. "Stage: recon (read-only)", "Recon" and "recon" each name the stage
 * recon, by its id or its name. Prose without headings is all overview.
 */
export function planDocument(prose: string, stages: readonly WorkflowStage[]): PlanDocument {
  const lines = prose.split(/\r?\n/u);
  let fence = false;
  const headings: { at: number; level: number; text: string }[] = [];
  lines.forEach((line, at) => {
    if (FENCE.test(line)) fence = !fence;
    const match = fence ? null : HEADING.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) headings.push({ at, level: match[1].length, text: match[2] });
  });
  if (headings.length === 0) return { overview: prose.trim(), sections: [] };
  const top = Math.min(...headings.map((heading) => heading.level));
  // Shift every heading so the top level would be `##`; a body never holds a top-level heading, so its own start at `###`.
  const shift = (text: string) => {
    let inFence = false;
    return text.split("\n").map((line) => {
      if (FENCE.test(line)) inFence = !inFence;
      return inFence ? line : line.replace(/^(#{1,6})(\s)/u, (_all, marks: string, space: string) => `${"#".repeat(Math.min(6, marks.length + 2 - top))}${space}`);
    }).join("\n");
  };
  const starts = headings.filter((heading) => heading.level === top);
  const find = (key: string) => stages.find((stage) => stage.id.toLowerCase() === key.toLowerCase() || stage.name.toLowerCase() === key.toLowerCase());
  const sections = starts.map((heading, index) => {
    const body = lines.slice(heading.at + 1, starts[index + 1]?.at ?? lines.length).join("\n").trim();
    const named = /^stage\s*:?\s*([\w-]+)(.*)$/iu.exec(heading.text);
    const stage = named?.[1] !== undefined ? find(named[1]) : find(heading.text);
    const rest = named?.[2]?.trim() ?? "";
    return { stage: stage?.id, title: stage === undefined ? heading.text : `${stage.name}${rest === "" ? "" : ` ${rest}`}`, body: shift(body) };
  });
  return { overview: shift(lines.slice(0, starts[0]?.at ?? 0).join("\n").trim()), sections };
}

/** A workflow file's plan: its prose, without the frontmatter, in sections. */
export function planOf(text: string, stages: readonly WorkflowStage[]): PlanDocument {
  return planDocument(proseOf(text), stages);
}
