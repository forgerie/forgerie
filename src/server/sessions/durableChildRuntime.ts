/**
 * What a Durable child really runs with, from an agent file written for pi-subagents.
 *
 * Agent files name tools, skills, and habits of the pi-subagents runtime. A Durable child has a different set. This
 * module decides, in one place, how each named capability is provided here: by the same tool, by an equivalent, or
 * not at all. Nothing is dropped silently: the child's instructions end with a section that states the differences,
 * and the parent's spawn result names what is missing.
 */
import { resolve } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { ChildAgentProfile } from "./durableChildProfiles.js";

/** A skill the child can load by reading its file. */
export interface ChildSkill { name: string; description: string; path: string }

/** Tools every Durable child can be given. */
const PROVIDED = new Set(["read", "write", "edit", "bash", "ask_human", "watchdog_diff"]);
export const isChildNativeTool = (name: string): boolean => PROVIDED.has(name);
/** Agent-file tool names with a different name or mechanism here, and what the child must know about it. */
const EQUIVALENT: Readonly<Record<string, { tool: string; note: string }>> = {
  grep: { tool: "bash", note: "grep, find, and ls run through bash." },
  find: { tool: "bash", note: "grep, find, and ls run through bash." },
  ls: { tool: "bash", note: "grep, find, and ls run through bash." },
  contact_supervisor: { tool: "ask_human", note: "contact_supervisor is ask_human here: it asks the user one question and waits for the answer." },
};

export interface ChildRuntimePlan {
  /** Tool names to offer; undefined offers child-native tools and host extras, not shared session tools. Always includes ask_human. */
  tools: readonly string[] | undefined;
  /** Tools the agent file names that this runtime cannot provide. */
  unavailable: readonly string[];
  skills: readonly ChildSkill[];
  /** Skills the agent file names that no skill folder holds. */
  missingSkills: readonly string[];
  /** The section appended to the child's instructions. Empty when nothing differs. */
  section: string;
}

/**
 * The child's tools and skills from its agent file. `availableTools` are eligible session tools and host extras.
 * `sessionSkills` are the skills the parent session can see; the agent file's own `skillPath` folders win.
 */
export function planChildRuntime(profile: ChildAgentProfile | undefined, availableTools: readonly string[], sessionSkills: readonly ChildSkill[]): ChildRuntimePlan {
  const offered = new Set<string>(["ask_human"]);
  const unavailable: string[] = [];
  const notes = new Set<string>();
  for (const name of profile?.tools ?? []) {
    const equivalent = EQUIVALENT[name];
    if (equivalent !== undefined) { offered.add(equivalent.tool); notes.add(equivalent.note); }
    else if (PROVIDED.has(name) || availableTools.includes(name)) offered.add(name);
    else if (!unavailable.includes(name)) unavailable.push(name);
  }
  const tools = profile?.tools === undefined ? undefined : [...offered];
  const has = (name: string) => tools === undefined || tools.includes(name);
  const { skills, missing } = resolveChildSkills(profile, sessionSkills);
  const lines = [
    ...notes,
    ...(has("read") ? ["read also opens PNG, JPEG, GIF, and WebP images: they come back as images you can see."] : []),
    ...(has("watchdog_diff") ? ["watchdog_diff reads committed ranges here: pass `range` (such as `main...HEAD`) and `cwd` for a worktree or another repository, and `offset` to page through a long diff. Do not ask anyone for a diff you can read this way."] : []),
    ...(unavailable.length === 0 ? [] : [`Not available here: ${unavailable.join(", ")}. Do not wait for them. Say in your answer what you could not check without them.`]),
    ...(missing.length === 0 ? [] : [`Skills your agent file names but this machine does not have: ${missing.join(", ")}.`]),
  ];
  const runtime = lines.length === 0 ? "" : `## This runtime\n\nYou run as a Forgerie child agent. Your agent file may have been written for another runtime. Where it describes a tool differently, this section is correct here:\n\n${lines.map((line) => `- ${line}`).join("\n")}`;
  return { tools, unavailable, skills, missingSkills: missing, section: [runtime, skillsSection(skills)].filter((part) => part !== "").join("\n\n") };
}

/** The agent file's `skills`, from its own `skillPath` folders first, then the session's skills. `inheritSkills: true` adds every session skill. */
function resolveChildSkills(profile: ChildAgentProfile | undefined, sessionSkills: readonly ChildSkill[]): { skills: ChildSkill[]; missing: string[] } {
  if (profile === undefined) return { skills: [], missing: [] };
  const local = profile.skillPaths.flatMap((dir) => loadSkillsFromDir({ dir: resolve(profile.dir, dir), source: "agent" }).skills)
    .map((skill) => ({ name: skill.name, description: skill.description, path: skill.filePath }));
  const find = (name: string) => local.find((skill) => skill.name === name) ?? sessionSkills.find((skill) => skill.name === name);
  const skills: ChildSkill[] = [];
  const missing: string[] = [];
  for (const name of profile.skills) {
    const skill = find(name);
    if (skill === undefined) missing.push(name);
    else if (!skills.some((known) => known.name === name)) skills.push(skill);
  }
  if (profile.inheritSkills) for (const skill of sessionSkills) if (!skills.some((known) => known.name === skill.name)) skills.push(skill);
  return { skills, missing };
}

function skillsSection(skills: readonly ChildSkill[]): string {
  if (skills.length === 0) return "";
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return ["## Skills", "", "Read a skill's file with the read tool before work it describes. Resolve a relative path in a skill against the skill's folder.", "",
    "<available_skills>",
    ...skills.flatMap((skill) => ["  <skill>", `    <name>${escape(skill.name)}</name>`, `    <description>${escape(skill.description)}</description>`, `    <location>${escape(skill.path)}</location>`, "  </skill>"]),
    "</available_skills>"].join("\n");
}

/** One line for the parent's spawn result, or empty when the child has everything its file names. */
export function runtimeGaps(plan: ChildRuntimePlan): string {
  const parts = [
    ...(plan.unavailable.length === 0 ? [] : [`tools ${plan.unavailable.join(", ")}`]),
    ...(plan.missingSkills.length === 0 ? [] : [`skills ${plan.missingSkills.join(", ")}`]),
  ];
  return parts.length === 0 ? "" : ` Not available to it here: ${parts.join("; ")}.`;
}

/** Native bash can write too, including when an old agent file asks for grep/find/ls. */
export function childIsWriter(tools: readonly string[] | undefined): boolean {
  return tools === undefined || tools.some((name) => name === "write" || name === "edit" || name === "bash");
}

/** Catalog recommendations describe declared capabilities; they do not promise this host can supply them. */
export function missingToolsRefusal(plan: ChildRuntimePlan, agents: readonly ChildAgentProfile[]): string | undefined {
  if (plan.unavailable.length === 0) return undefined;
  const alternatives = plan.unavailable.map((tool) => {
    const names = agents.filter((agent) => agent.tools?.includes(tool) === true).map((agent) => agent.name);
    return `${tool}: ${names.length === 0 ? "no catalog agents declare it" : names.join(", ")}`;
  });
  return `Cannot spawn: missing tools ${plan.unavailable.join(", ")}. Catalog agents that declare them: ${alternatives.join("; ")}. Choose a suitable agent or set allowMissingTools: true to proceed without them.`;
}
