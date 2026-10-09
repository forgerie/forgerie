/** Which agent file a settings page shows. `customize` starts a user copy of a built-in agent. */
export type AgentTarget = { type: "new" } | { type: "user" | "builtin" | "customize"; file: string };

/** Where settings is open, as the URL holds it: `?settings=<section>&agent=<target>`, `&plugin=<id>` or `&group=<id>`. */
export interface SettingsPlace {
  section: "root" | "agents" | "plugins" | "models" | "projects";
  agent?: AgentTarget | undefined; plugin?: string | undefined;
  /** A project group's id, or `new`. */
  group?: string | undefined;
}

export const targetParam = (target: AgentTarget) => target.type === "new" ? "new" : `${target.type}/${target.file}`;
export function readTarget(value: string | undefined): AgentTarget | undefined {
  if (!value) return undefined;
  if (value === "new") return { type: "new" };
  const slash = value.indexOf("/");
  const type = value.slice(0, slash);
  const file = value.slice(slash + 1);
  return slash > 0 && file && (type === "user" || type === "builtin" || type === "customize") ? { type, file } : undefined;
}
/** Drafts belong to the file they will be saved to. */
export const draftKey = (target: AgentTarget) => target.type === "new" ? "new" : `${target.type === "builtin" ? "builtin" : "user"}:${target.file}`;
