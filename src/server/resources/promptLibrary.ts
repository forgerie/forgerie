import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isBuiltinCommand } from "../sessions/builtinCommands.js";

/**
 * Authoring side of the prompt library the agent profile keeps in
 * `<agentDir>/prompts/*.md`. `PromptResourceCatalogService` reads that
 * directory; this writes it. The contract hides name policy, YAML frontmatter
 * rendering, and every filesystem failure mode behind one `save` call that
 * always returns an explained outcome instead of throwing.
 */
export interface PromptLibrary {
  save(draft: PromptDraft): Promise<PromptSaveResult>;
}

export interface PromptDraft {
  name: string;
  body: string;
}

export type PromptSaveResult =
  | { kind: "saved"; name: string; path: string }
  | { kind: "invalid-name"; message: string }
  | { kind: "name-taken"; message: string }
  | { kind: "empty-body"; message: string }
  | { kind: "write-failed"; message: string };

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 120;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

export class AgentDirPromptLibrary implements PromptLibrary {
  private readonly promptsDir: string;

  constructor(agentDir: string) {
    this.promptsDir = join(agentDir, "prompts");
  }

  async save(draft: PromptDraft): Promise<PromptSaveResult> {
    const name = normalizePromptName(draft.name);
    const nameProblem = promptNameProblem(name);
    if (nameProblem !== undefined) return { kind: "invalid-name", message: nameProblem };

    const body = draft.body.trim();
    if (body === "") return { kind: "empty-body", message: `No prompt text. Put the prompt body after the name: /prompt-new ${name} <prompt text…>` };

    const path = join(this.promptsDir, `${name}.md`);
    try {
      // Kept out of the write's try block: mkdir also reports EEXIST when the
      // path is an ordinary file, which must not read as "that prompt exists".
      await mkdir(this.promptsDir, { recursive: true });
    } catch (error: unknown) {
      return { kind: "write-failed", message: `Could not open ${this.promptsDir}: ${errorMessage(error)}` };
    }
    try {
      // Exclusive create: never silently overwrite a prompt the user already
      // relies on, and decide it in one atomic syscall rather than stat-then-write.
      await writeFile(path, renderPromptFile(body), { encoding: "utf8", flag: "wx" });
    } catch (error: unknown) {
      if (isErrnoCode(error, "EEXIST")) return { kind: "name-taken", message: `/${name} already exists at ${path}. Pick another name, or edit that file directly.` };
      return { kind: "write-failed", message: `Could not write ${path}: ${errorMessage(error)}` };
    }
    return { kind: "saved", name, path };
  }
}

/**
 * Splits `<name> <body…>`. The body keeps its own line breaks, so a prompt is
 * written the way it is typed: name on the command line, prompt underneath.
 */
export function parsePromptDraft(args: string): PromptDraft {
  const trimmed = args.trim();
  const boundary = /\s/u.exec(trimmed);
  if (boundary === null) return { name: trimmed, body: "" };
  return { name: trimmed.slice(0, boundary.index), body: trimmed.slice(boundary.index).trim() };
}

/**
 * Phone keyboards capitalize the first word and users often repeat the slash,
 * so both are normalized away instead of rejected.
 */
export function normalizePromptName(name: string): string {
  return name.trim().replace(/^\/+/u, "").toLowerCase();
}

export function promptNameProblem(name: string): string | undefined {
  if (name === "") return "Usage: /prompt-new <name> <prompt text…>";
  if (name.length > MAX_NAME_LENGTH) return `Prompt name is too long: keep it to ${String(MAX_NAME_LENGTH)} characters or fewer.`;
  if (!NAME_PATTERN.test(name)) return `Invalid prompt name "${name}". Use lowercase letters, digits, and dashes, starting with a letter or digit.`;
  if (isBuiltinCommand(name)) return `/${name} is a built-in command and would shadow the prompt. Pick another name.`;
  return undefined;
}

/**
 * A body that already opens with `---` is treated as a complete prompt file:
 * the author is writing their own frontmatter. Otherwise a description is
 * derived from the first line so the prompt is legible in the command picker
 * without asking for it separately.
 */
export function renderPromptFile(body: string): string {
  const text = withTrailingNewline(body);
  if (/^---\r?\n/u.test(text)) return text;
  return `---\ndescription: ${yamlScalar(deriveDescription(body))}\n---\n\n${text}`;
}

function deriveDescription(body: string): string {
  const firstLine = body.split("\n").find((line) => line.trim() !== "") ?? "";
  const summary = firstLine.trim().replace(/^#{1,6}\s+/u, "").replace(/\s+/gu, " ");
  if (summary.length <= MAX_DESCRIPTION_LENGTH) return summary;
  return `${summary.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

/** Plain YAML scalars break on `:` and `#`; JSON quoting is valid YAML and escapes everything. */
function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][^:#\r\n]*$/u.test(value) ? value : JSON.stringify(value);
}

function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function isErrnoCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const errorCode: unknown = error.code;
  return errorCode === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
