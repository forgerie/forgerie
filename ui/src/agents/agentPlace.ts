/** Which agent file a settings page shows. `home` is a file in `~/.agents`; `customize` starts a profile copy of a built-in agent. */
export type AgentTarget = { type: "new" } | { type: "home" | "user" | "builtin" | "customize"; file: string };

/** Where settings is open, as the URL holds it: `?settings=<section>&agent=<target>`, `&plugin=<id>`, `&group=<id>` or `&resource=<id>`. */
export interface SettingsPlace {
  section: "root" | "agents" | "plugins" | "models" | "projects" | "resources";
  agent?: AgentTarget | undefined; plugin?: string | undefined;
  /** A project group's id, or `new`. */
  group?: string | undefined;
  /** The open skill, prompt or context file's id. */
  resource?: string | undefined;
}

export const targetParam = (target: AgentTarget) => target.type === "new" ? "new" : `${target.type}/${target.file}`;
export function readTarget(value: string | undefined): AgentTarget | undefined {
  if (!value) return undefined;
  if (value === "new") return { type: "new" };
  const slash = value.indexOf("/");
  const type = value.slice(0, slash);
  const file = value.slice(slash + 1);
  return slash > 0 && file && (type === "home" || type === "user" || type === "builtin" || type === "customize") ? { type, file } : undefined;
}
/** Drafts belong to the file they will be saved to. A customized copy saves to the profile, so it shares the profile file's draft. */
export const draftKey = (target: AgentTarget) => target.type === "new" ? "new" : `${target.type === "customize" ? "user" : target.type}:${target.file}`;
