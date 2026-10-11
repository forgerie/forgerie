import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** What a Durable child runs with, read from one agent file. */
export interface ChildAgentProfile {
  name: string;
  description: string;
  source: { path: string; sha256: string };
  model?: { provider: string; modelId: string };
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Tool names from the file; undefined offers every child tool. */
  tools?: readonly string[];
  /** The file body. */
  prompt: string;
  /** Whether the child also gets the project's AGENTS.md files. Default true. */
  inheritProjectContext: boolean;
  /** The folder the file is in; `skillPaths` are relative to it. */
  dir: string;
  /** Skills the file names, by name. */
  skills: readonly string[];
  /** Extra skill folders, relative to `dir`. */
  skillPaths: readonly string[];
  /** Whether the child sees every skill the session sees. Only an explicit `inheritSkills: true` turns it on. */
  inheritSkills: boolean;
}

const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
type Thinking = NonNullable<ChildAgentProfile["thinkingLevel"]>;
const isThinking = (value: string): value is Thinking => THINKING.has(value);

/**
 * Agent files in the format pi-subagents uses, so one file serves both runtimes. Project files win over user files,
 * and user files win over built-in ones, as in pi-subagents. Only flat frontmatter values are read.
 */
export class ChildAgentCatalog {
  constructor(private readonly dirs: readonly string[]) {}

  /** Project `.pi/agents`, then the profile's `agents`, then the built-in folders in order. */
  static forSession(cwd: string, agentDir: string, builtinDirs: readonly string[] = []): ChildAgentCatalog {
    return new ChildAgentCatalog([join(cwd, ".pi", "agents"), join(agentDir, "agents"), ...builtinDirs]);
  }

  async list(): Promise<ChildAgentProfile[]> {
    const byName = new Map<string, ChildAgentProfile>();
    for (const dir of this.dirs) {
      for (const file of await markdownFiles(dir)) {
        const profile = parseChildAgentFile(await readFile(file), file);
        if (profile !== undefined && !byName.has(profile.name)) byName.set(profile.name, profile);
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async find(name: string): Promise<ChildAgentProfile | undefined> {
    return (await this.list()).find((profile) => profile.name === name);
  }
}

async function markdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => join(dir, entry.name)).sort();
}

/** Undefined for a file without frontmatter, a disabled agent, or one pi-subagents would refuse. */
export function parseChildAgentFile(text: string | Buffer, path = "agent.md"): ChildAgentProfile | undefined {
  const normalized = (typeof text === "string" ? text : text.toString("utf8")).replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return undefined;
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return undefined;
  const fields = new Map<string, string>();
  for (const line of normalized.slice(4, end).split("\n")) {
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (match?.[1] === undefined) continue;
    const value = (match[2] ?? "").trim();
    fields.set(match[1], /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value);
  }
  if (fields.get("disabled") === "true" || fields.has("fallbackModels")) return undefined;
  const name = fields.get("name") ?? path.split("/").at(-1)?.replace(/\.md$/, "") ?? "";
  if (name === "") return undefined;
  let modelSpec = fields.get("model");
  let thinkingLevel = fields.get("thinking");
  const suffix = modelSpec === undefined ? undefined : /^(.*):(off|minimal|low|medium|high|xhigh)$/.exec(modelSpec);
  if (suffix !== null && suffix !== undefined) { modelSpec = suffix[1]; thinkingLevel = suffix[2]; }
  const slash = modelSpec?.indexOf("/") ?? -1;
  const list = (key: string) => fields.get(key)?.split(",").map((item) => item.trim()).filter((item) => item !== "");
  const tools = list("tools");
  return {
    name,
    source: { path, sha256: createHash("sha256").update(text).digest("hex") },
    description: fields.get("description") ?? "",
    ...(modelSpec !== undefined && slash > 0 ? { model: { provider: modelSpec.slice(0, slash), modelId: modelSpec.slice(slash + 1) } } : {}),
    ...(thinkingLevel !== undefined && isThinking(thinkingLevel) ? { thinkingLevel } : {}),
    ...(tools === undefined || tools.length === 0 ? {} : { tools }),
    prompt: normalized.slice(end + 4).trim(),
    inheritProjectContext: fields.get("inheritProjectContext") !== "false",
    dir: dirname(path),
    skills: [...(list("skills") ?? []), ...(list("skill") ?? [])],
    skillPaths: list("skillPath") ?? [],
    inheritSkills: fields.get("inheritSkills") === "true",
  };
}
