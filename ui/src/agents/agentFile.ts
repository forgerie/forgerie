/**
 * One pi-subagents agent file: a YAML-ish header and a Markdown body. Edits
 * change only the header lines of the fields they touch, so comments, field
 * order, and fields this client does not know survive a save byte for byte.
 * Values are read the way pi-subagents' own parser reads them.
 */
export interface AgentFile {
  /** Header lines between the `---` fences, or undefined when the file has none. */
  header: string[] | undefined;
  /** Everything after the closing fence, exactly as stored. */
  body: string;
}

/** Fields the form edits. Every other header line is carried through untouched. */
export const FORM_FIELDS = ["name", "description", "model", "thinking", "fallbackModels", "advertise"] as const;
export type FormField = (typeof FORM_FIELDS)[number];

export function parseAgentFile(text: string): AgentFile {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { header: undefined, body: normalized };
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { header: undefined, body: normalized };
  const after = normalized.slice(end + 4);
  const lineEnd = after.indexOf("\n");
  // The closing fence owns the rest of its line.
  return { header: normalized.slice(4, end).split("\n"), body: lineEnd === -1 ? "" : after.slice(lineEnd + 1) };
}

export function composeAgentFile(file: AgentFile): string {
  return file.header === undefined ? file.body : `---\n${file.header.join("\n")}\n---\n${file.body}`;
}

const KEY = /^([\w-]+):\s*(.*)$/;
const BLOCK = new Set(["", "|", "|-", ">", ">-"]);

/** The line range one top-level key occupies, including its indented block. */
function extent(lines: readonly string[], key: string): { start: number; end: number } | undefined {
  const start = lines.findIndex((line) => KEY.exec(line)?.[1] === key);
  if (start === -1) return undefined;
  const raw = (KEY.exec(lines[start] ?? "")?.[2] ?? "").trim();
  let end = start + 1;
  if (BLOCK.has(raw)) while (end < lines.length && (/^\s+\S/.test(lines[end] ?? "") || (lines[end] ?? "") === "" && /^\s+\S/.test(lines[end + 1] ?? ""))) end++;
  return { start, end };
}

export function readFields(header: readonly string[] | undefined): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!header) return fields;
  for (const line of header) {
    const key = KEY.exec(line)?.[1];
    if (!key || key in fields) continue;
    const range = extent(header, key);
    if (!range) continue;
    const raw = (KEY.exec(line)?.[2] ?? "").trim();
    if (BLOCK.has(raw)) {
      const block = header.slice(range.start + 1, range.end);
      const indent = Math.min(...block.filter((item) => item.trim()).map((item) => item.search(/\S/)));
      const lines = block.map((item) => item.slice(Number.isFinite(indent) ? indent : 0));
      fields[key] = raw.startsWith(">") ? lines.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ").trim() : lines.join("\n").trim();
    } else fields[key] = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
  }
  return fields;
}

function serialize(key: string, value: string): string[] {
  if (value.includes("\n")) return [`${key}: |`, ...value.split("\n").map((line) => line === "" ? "" : `  ${line}`)];
  // pi-subagents strips one pair of matching quotes, so quote a value that has its own.
  return [/^(["']).*\1$/.test(value) || BLOCK.has(value) ? `${key}: "${value}"` : `${key}: ${value}`];
}

/** Set, replace, or (with undefined) remove one header field. Other lines stay as they were. */
export function setField(header: readonly string[] | undefined, key: string, value: string | undefined): string[] {
  const lines = [...(header ?? [])];
  const range = extent(lines, key);
  const next = value === undefined ? [] : serialize(key, value);
  if (range) lines.splice(range.start, range.end - range.start, ...next);
  else lines.push(...next);
  return lines;
}

/** A model reference as pi-subagents takes it: `provider/id`, a bare id, and an optional `:level`. */
export interface ModelSpec { provider?: string | undefined; id: string; level?: string | undefined }
const LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export function parseModelSpec(spec: string | undefined): ModelSpec | undefined {
  const value = spec?.trim();
  if (!value || value === "inherit") return undefined;
  const colon = value.lastIndexOf(":");
  const level = colon > 0 && LEVELS.has(value.slice(colon + 1)) ? value.slice(colon + 1) : undefined;
  const base = level ? value.slice(0, colon) : value;
  const slash = base.indexOf("/");
  return slash > 0 ? { provider: base.slice(0, slash), id: base.slice(slash + 1), level } : { id: base, level };
}
export function modelSpecText(spec: ModelSpec): string {
  return spec.provider ? `${spec.provider}/${spec.id}` : spec.id;
}

/** pi-subagents' own list syntax: comma-separated or `- item` lines. */
export function parseList(value: string | undefined): string[] {
  return (value ?? "").split("\n").flatMap((line) => (/^\s*-\s+(.+)$/.exec(line)?.[1] ?? line).split(",")).map((item) => item.trim()).filter(Boolean);
}

/** An agent name becomes its file name. pi-subagents treats the two separately, so this is only the default. */
export function fileIdFor(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "");
}

export const NEW_AGENT_TEXT = "---\nname: \ndescription: \nadvertise: true\n---\n\n";
