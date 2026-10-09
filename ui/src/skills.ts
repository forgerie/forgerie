/**
 * A `/skill:name` command as Pi records it: the skill's own text expanded into
 * the user message, followed by whatever the person typed after the command.
 */
export interface SkillInvocation { name: string; location: string; content: string; argument?: string }

// Pi's own format (pi-coding-agent `formatSkillInvocation` / `parseSkillBlock`).
// The whole message must be the block, so prose that quotes one stays text.
// Forgerie's Durable runtime briefly wrote one newline before the argument and
// kept the SKILL.md frontmatter; those stored messages still parse.
const SKILL_BLOCK = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n([\s\S]*))?$/;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

export function parseSkillInvocation(text: string): SkillInvocation | undefined {
  const match = SKILL_BLOCK.exec(text);
  if (!match) return undefined;
  const argument = match[4]?.trim();
  const content = match[3]!.replace(FRONTMATTER, "").replace(/^\s+/, "");
  return { name: match[1]!, location: match[2]!, content, ...(argument ? { argument } : {}) };
}

/** The agent loading a skill: a `read` of that skill's `SKILL.md`. */
export interface SkillLoad { name: string; path: string }

export function skillLoadOf(toolName: string, args: unknown): SkillLoad | undefined {
  if (toolName !== "read" || typeof args !== "object" || args === null || !("path" in args)) return undefined;
  const path = args.path;
  if (typeof path !== "string") return undefined;
  const segments = path.split(/[\\/]/);
  const name = segments.length >= 2 && segments.at(-1) === "SKILL.md" ? segments.at(-2) : undefined;
  // `./SKILL.md` and `../SKILL.md` name no directory, so they cannot name a skill.
  return name && name !== "." && name !== ".." ? { name, path } : undefined;
}
