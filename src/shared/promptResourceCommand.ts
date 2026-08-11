export type PromptResourceCommandSource = "prompt" | "skill";

export interface ParsedPromptResourceCommand {
  name: string;
  args: string;
}

export type LeadingSlashCommandParseResult = ParsedPromptResourceCommand | { kind: "not-command" } | { kind: "invalid"; reason: "missing-name" };

export interface PromptResourceCommandFingerprintInput {
  source: PromptResourceCommandSource;
  name: string;
  origin: string;
  content: string;
  baseDir?: string | undefined;
}

export interface PromptResourceCommandIdentity {
  source: PromptResourceCommandSource;
  name: string;
  fingerprint: string;
}

export interface PromptResourceCommandDescriptor {
  name: string;
  source: PromptResourceCommandSource;
  identity: PromptResourceCommandIdentity;
  description?: string;
}

export interface PromptResourceCatalogAvailable {
  available: true;
  commands: PromptResourceCommandDescriptor[];
  diagnostics: string[];
}

export function parseLeadingSlashCommand(input: string): LeadingSlashCommandParseResult {
  if (!input.startsWith("/")) return { kind: "not-command" };
  const afterSlash = input.slice(1);
  const match = /\s/u.exec(afterSlash);
  const name = match === null ? afterSlash : afterSlash.slice(0, match.index);
  if (name === "") return { kind: "invalid", reason: "missing-name" };
  const args = match === null ? "" : afterSlash.slice(match.index + match[0].length);
  return { name, args };
}

export async function fingerprintPromptResourceCommand(input: PromptResourceCommandFingerprintInput): Promise<string> {
  const payload = JSON.stringify({
    schema: 1,
    source: input.source,
    name: input.name,
    origin: input.origin,
    content: input.content,
    baseDir: input.baseDir ?? null,
  });
  const bytes = new TextEncoder().encode(payload);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
