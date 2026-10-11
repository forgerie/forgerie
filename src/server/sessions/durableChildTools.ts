/**
 * Tools that give a Durable child what agent files expect from pi-subagents: `watchdog_diff`, and a `read` that
 * opens images. Both are read-only.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, wrapTool, type ToolRegistration, type Wrap } from "@earendil-works/pi-durable";
import { sanitizedGitEnv } from "../git/gitEnv.js";

const run = promisify(execFile);
/** One page of diff output. pi-subagents bounds a call at 24,000 characters; a page here is larger and continues. */
export const DIFF_PAGE_CHARS = 60_000;
const MAX_UNTRACKED = 50;
const MAX_COMMITS = 100;
/** A revision or a range of two. Refuses option-like and shell-like input; Git runs without a shell. */
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._/@^~{}-]*$/u;

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], { env: sanitizedGitEnv(), maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
  return stdout;
}

/** Why a range or a path cannot be used, or undefined. */
export function diffInputProblem(range: string | undefined, path: string | undefined): string | undefined {
  if (range !== undefined) {
    const ends = range.split(/\.\.\.?/u);
    if (ends.length > 2 || ends.some((end) => !REVISION.test(end))) return `range must be one revision or two joined by .. or ...; got ${range}`;
  }
  if (path !== undefined && (path.startsWith("-") || path.startsWith("/") || path.split(/[\\/]/u).includes(".."))) return "path must be relative to the repository root, without ..";
  return undefined;
}

/** A page of text and the note that says where the next page starts. */
export function page(text: string, offset: number): string {
  const start = Math.max(0, Math.min(offset, text.length));
  const end = Math.min(text.length, start + DIFF_PAGE_CHARS);
  const body = text.slice(start, end);
  return end < text.length ? `${body}\n\n[characters ${String(start)}-${String(end)} of ${String(text.length)}; call again with offset ${String(end)}, or narrow with path or stat]` : body;
}

export const watchdogDiffTool = defineTool({
  name: "watchdog_diff",
  description: "Read-only Git diff. Without range: the staged and unstaged changes against HEAD now, plus untracked paths. With range (such as main...feature or abc123..HEAD): the commits in the range and their diff. cwd picks another repository or worktree. path narrows to one file or folder; stat:true gives per-file counts; offset pages through a long diff.",
  parameters: Type.Object({
    range: Type.Optional(Type.String({ description: "A revision range, such as main...feature. Omit for uncommitted changes." })),
    cwd: Type.Optional(Type.String({ description: "Repository or worktree folder. Default: your working directory." })),
    path: Type.Optional(Type.String({ description: "One file or folder, relative to the repository root." })),
    stat: Type.Optional(Type.Boolean({ description: "Per-file change counts instead of the full diff." })),
    offset: Type.Optional(Type.Integer({ minimum: 0, description: "Character offset of the page to return." })),
  }, { additionalProperties: false }),
  replay: "safe",
  execute: async (args, api, context) => {
    const problem = diffInputProblem(args.range, args.path);
    if (problem !== undefined) return { content: [{ type: "text" as const, text: problem }], isError: true };
    if (api.env === undefined) return { content: [{ type: "text" as const, text: "No working directory is configured." }], isError: true };
    const folder = await api.env.absolutePath(args.cwd ?? ".", context);
    if (!folder.ok) return { content: [{ type: "text" as const, text: `Cannot use ${args.cwd ?? "."}: ${folder.error.message}` }], isError: true };
    const paths = args.path === undefined ? [] : ["--", args.path];
    const shape = ["--no-color", "--no-ext-diff", "--no-textconv", ...(args.stat === true ? ["--stat"] : [])];
    try {
      let text: string;
      if (args.range === undefined) {
        const diff = await git(folder.value, ["diff", ...shape, "HEAD", ...paths]);
        const untracked = (await git(folder.value, ["ls-files", "--others", "--exclude-standard", ...paths])).split("\n").filter((line) => line !== "");
        text = [diff.trim() === "" ? "No staged or unstaged changes against HEAD." : diff,
          ...(untracked.length === 0 ? [] : [`Untracked (${String(untracked.length)}):\n${untracked.slice(0, MAX_UNTRACKED).join("\n")}${untracked.length > MAX_UNTRACKED ? `\n… ${String(untracked.length - MAX_UNTRACKED)} more` : ""}`])].join("\n\n");
      } else {
        const log = await git(folder.value, ["log", "--no-color", "--format=%h %s", `--max-count=${String(MAX_COMMITS)}`, args.range, ...paths]);
        const diff = await git(folder.value, ["diff", ...shape, args.range, ...paths]);
        text = `Commits in ${args.range}:\n${log.trim() === "" ? "(none)" : log.trim()}\n\n${diff.trim() === "" ? "No differences." : diff}`;
      }
      return { content: [{ type: "text" as const, text: page(text, args.offset ?? 0) }] };
    } catch (error) {
      const stderr = typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
      return { content: [{ type: "text" as const, text: `git failed in ${folder.value}: ${stderr || (error instanceof Error ? error.message : String(error))}` }], isError: true };
    }
  },
});

/** The largest image sent to a model; providers refuse larger ones. Base64 adds a third. */
export const MAX_IMAGE_BYTES = 3_750_000;

/** The image type from its first bytes, for the formats models accept. */
export function imageType(bytes: Uint8Array): string | undefined {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return undefined;
}

/** Durable's read refuses images. This wrap returns the image itself, so a child can look at a screenshot. */
export function readsImages(read: ToolRegistration): Wrap {
  return wrapTool(read, (tool) => ({
    ...tool,
    description: `${tool.description} Images (PNG, JPEG, GIF, WebP) come back as images you can see.`,
    execute: async (args, api, context) => {
      const result = await tool.execute(args, api, context);
      if (result.diagnostics?.some((diagnostic) => diagnostic.code === "unsupported_image") !== true || api.env === undefined) return result;
      const path = typeof args === "object" && args !== null && "path" in args && typeof args.path === "string" ? args.path : "";
      const absolute = await api.env.absolutePath(path, context);
      const bytes = absolute.ok ? await api.env.readBinaryFile(absolute.value, context) : undefined;
      if (bytes?.ok !== true) return result;
      const mimeType = imageType(bytes.value);
      if (mimeType === undefined) return result;
      if (bytes.value.length > MAX_IMAGE_BYTES) {
        return { content: [{ type: "text" as const, text: `${path} is a ${mimeType} image of ${String(Math.round(bytes.value.length / 1000))} KB, above the ${String(MAX_IMAGE_BYTES / 1_000_000)} MB a model accepts. Make a smaller copy and read that.` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: `${path}: ${mimeType}, ${String(Math.round(bytes.value.length / 1000))} KB` },
        { type: "image" as const, data: Buffer.from(bytes.value).toString("base64"), mimeType }] };
    },
  }));
}
