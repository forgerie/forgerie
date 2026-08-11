import { stripFrontmatter } from "@earendil-works/pi-coding-agent";
import type { SlashCommand } from "../../shared/apiTypes.js";
import { fingerprintPromptResourceCommand, parseLeadingSlashCommand, type PromptResourceCatalogAvailable, type PromptResourceCommandDescriptor, type PromptResourceCommandIdentity, type PromptResourceCommandSource } from "../../shared/promptResourceCommand.js";

export type CommandSource = SlashCommand["source"];

export interface CanonicalBuiltinCommandInput {
  name: string;
  description?: string | undefined;
  source: "builtin";
}

export interface CanonicalExtensionCommandInput {
  name: string;
  description?: string | undefined;
  source: "extension";
}

export interface CanonicalPromptResourceInput {
  name: string;
  description?: string | undefined;
  content: string;
  origin: string;
}

export interface CanonicalSkillResourceInput extends CanonicalPromptResourceInput {
  baseDir: string;
  filePath?: string | undefined;
}

export interface ActiveCommandCatalogInput {
  builtins: readonly CanonicalBuiltinCommandInput[];
  extensions: readonly CanonicalExtensionCommandInput[];
  prompts: readonly CanonicalPromptResourceInput[];
  skills: readonly CanonicalSkillResourceInput[];
}

export interface CanonicalRuntimePromptInput {
  name: string;
}

export interface CanonicalRuntimeSkillInput {
  name: string;
}

export interface CanonicalCommandNameInput {
  builtins: readonly CanonicalBuiltinCommandInput[];
  extensions: readonly CanonicalExtensionCommandInput[];
  prompts: readonly CanonicalRuntimePromptInput[];
  skills: readonly CanonicalRuntimeSkillInput[];
}

export interface ActiveCommandCatalog {
  commands: SlashCommand[];
  firstPromptCommands: PromptResourceCommandDescriptor[];
  resourceCommands: PromptResourceCommandRecord[];
}

export interface PromptResourceCommandRecord extends PromptResourceCommandDescriptor {
  content: string;
  origin: string;
  baseDir?: string | undefined;
  filePath?: string | undefined;
}

export type PromptResourceIdentityResolution =
  | { kind: "matched"; command: PromptResourceCommandRecord; args: string }
  | { kind: "unsupported"; reason: "not-command" | "invalid" | "unknown" | "identity-mismatch" };

const SOURCE_RANK: Record<CommandSource, number> = {
  builtin: 0,
  extension: 1,
  skill: 2,
  prompt: 3,
};

export async function buildActiveCommandCatalog(input: ActiveCommandCatalogInput): Promise<ActiveCommandCatalog> {
  const candidates: (SlashCommand | PromptResourceCommandRecord)[] = [];
  candidates.push(...input.builtins.map((command) => clientCommand(command.name, "builtin", command.description)));
  candidates.push(...input.extensions.map((command) => clientCommand(command.name, "extension", command.description)));
  candidates.push(...await promptResourceRecordsFromSkills(input.skills));
  candidates.push(...await promptResourceRecordsFromPrompts(input.prompts));

  const winners = canonicalWinners(candidates);
  const resourceCommands = sortResourceCommands(winners.filter(isPromptResourceCommandRecord));
  const commands = sortCommands(winners.map(toClientCommand));
  return {
    commands,
    firstPromptCommands: resourceCommands.map(toPromptResourceDescriptor),
    resourceCommands,
  };
}

export async function buildPromptResourceCatalogFromResources(input: { prompts: readonly CanonicalPromptResourceInput[]; skills: readonly CanonicalSkillResourceInput[]; diagnostics?: readonly string[] }): Promise<PromptResourceCatalogAvailable> {
  const candidates = [
    ...await promptResourceRecordsFromSkills(input.skills),
    ...await promptResourceRecordsFromPrompts(input.prompts),
  ];
  const commands = sortResourceCommands(canonicalWinners(candidates).filter(isPromptResourceCommandRecord)).map(toPromptResourceDescriptor);
  return { available: true, commands, diagnostics: [...input.diagnostics ?? []] };
}

export function resolveCanonicalCommandSource(input: CanonicalCommandNameInput, name: string): CommandSource | undefined {
  return canonicalWinners(canonicalNameCandidates(input)).find((command) => command.name === name)?.source;
}

export function resolvePromptResourceIdentity(catalog: ActiveCommandCatalog, text: string, identity: PromptResourceCommandIdentity): PromptResourceIdentityResolution {
  const parsed = parseLeadingSlashCommand(text);
  if ("kind" in parsed) return { kind: "unsupported", reason: parsed.kind === "not-command" ? "not-command" : "invalid" };
  const command = catalog.resourceCommands.find((candidate) => candidate.name === parsed.name);
  if (command === undefined) return { kind: "unsupported", reason: "unknown" };
  if (command.identity.source !== identity.source || command.identity.name !== identity.name || command.identity.fingerprint !== identity.fingerprint) {
    return { kind: "unsupported", reason: "identity-mismatch" };
  }
  return { kind: "matched", command, args: parsed.args };
}

function clientCommand(name: string, source: CommandSource, description: string | undefined): SlashCommand {
  return { name, source, ...(description === undefined || description === "" ? {} : { description }) };
}

async function promptResourceRecordsFromPrompts(prompts: readonly CanonicalPromptResourceInput[]): Promise<PromptResourceCommandRecord[]> {
  return Promise.all(prompts.map((prompt) => promptResourceRecord({ source: "prompt", name: prompt.name, description: prompt.description, content: prompt.content, origin: prompt.origin })));
}

async function promptResourceRecordsFromSkills(skills: readonly CanonicalSkillResourceInput[]): Promise<PromptResourceCommandRecord[]> {
  return Promise.all(skills.map((skill) => promptResourceRecord({ source: "skill", name: `skill:${skill.name}`, description: skill.description, content: skill.content, origin: skill.origin, baseDir: skill.baseDir, filePath: skill.filePath })));
}

export function expandPromptResourceCommand(command: PromptResourceCommandRecord, argsText: string): string {
  if (command.source === "prompt") return substituteArgs(command.content, parseCommandArgs(argsText));
  const skillName = command.name.startsWith("skill:") ? command.name.slice("skill:".length) : command.name;
  const body = stripFrontmatter(command.content).trim();
  const location = command.filePath ?? command.origin;
  const baseDir = command.baseDir ?? "";
  const skillBlock = `<skill name="${skillName}" location="${location}">
References are relative to ${baseDir}.

${body}
</skill>`;
  const args = argsText.trim();
  return args === "" ? skillBlock : `${skillBlock}

${args}`;
}

async function promptResourceRecord(input: { source: PromptResourceCommandSource; name: string; description?: string | undefined; content: string; origin: string; baseDir?: string | undefined; filePath?: string | undefined }): Promise<PromptResourceCommandRecord> {
  const fingerprint = await fingerprintPromptResourceCommand(input);
  return {
    name: input.name,
    source: input.source,
    ...(input.description === undefined || input.description === "" ? {} : { description: input.description }),
    identity: { source: input.source, name: input.name, fingerprint },
    content: input.content,
    origin: input.origin,
    ...(input.baseDir === undefined ? {} : { baseDir: input.baseDir }),
    ...(input.filePath === undefined ? {} : { filePath: input.filePath }),
  };
}

function canonicalNameCandidates(input: CanonicalCommandNameInput): SlashCommand[] {
  return [
    ...input.builtins.map((command) => clientCommand(command.name, "builtin", command.description)),
    ...input.extensions.map((command) => clientCommand(command.name, "extension", command.description)),
    ...input.skills.map((skill) => clientCommand(`skill:${skill.name}`, "skill", undefined)),
    ...input.prompts.map((prompt) => clientCommand(prompt.name, "prompt", undefined)),
  ];
}

function canonicalWinners<T extends SlashCommand | PromptResourceCommandRecord>(commands: readonly T[]): T[] {
  const winners = new Map<string, T>();
  for (const command of commands) {
    const previous = winners.get(command.name);
    if (previous === undefined || compareCanonicalWinner(command, previous) < 0) winners.set(command.name, command);
  }
  return [...winners.values()];
}

function compareCanonicalWinner(a: SlashCommand | PromptResourceCommandRecord, b: SlashCommand | PromptResourceCommandRecord): number {
  return SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
    || codePointCompare(originKey(a), originKey(b))
    || codePointCompare(fingerprintKey(a), fingerprintKey(b));
}

function toClientCommand(command: SlashCommand | PromptResourceCommandRecord): SlashCommand {
  return clientCommand(command.name, command.source, command.description);
}

function toPromptResourceDescriptor(command: PromptResourceCommandRecord): PromptResourceCommandDescriptor {
  return { name: command.name, source: command.source, identity: command.identity, ...(command.description === undefined ? {} : { description: command.description }) };
}

function sortCommands(commands: SlashCommand[]): SlashCommand[] {
  return commands.sort(compareCommands);
}

function sortResourceCommands(commands: PromptResourceCommandRecord[]): PromptResourceCommandRecord[] {
  return commands.sort(compareCommands);
}

function compareCommands(a: Pick<SlashCommand, "name" | "source">, b: Pick<SlashCommand, "name" | "source">): number {
  return codePointCompare(a.name, b.name) || codePointCompare(a.source, b.source) || codePointCompare(originKey(a), originKey(b));
}

function originKey(command: Pick<SlashCommand, "name" | "source">): string {
  return "origin" in command && typeof command.origin === "string" ? command.origin : "";
}

function fingerprintKey(command: Pick<SlashCommand, "name" | "source">): string {
  return "identity" in command && typeof command.identity === "object" && command.identity !== null && "fingerprint" in command.identity && typeof command.identity.fingerprint === "string" ? command.identity.fingerprint : "";
}

function codePointCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function isPromptResourceCommandRecord(command: SlashCommand | PromptResourceCommandRecord): command is PromptResourceCommandRecord {
  return command.source === "prompt" || command.source === "skill";
}

function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | undefined;
  for (const char of argsString) {
    if (inQuote !== undefined) {
      if (char === inQuote) inQuote = undefined;
      else current += char;
    } else if (char === "\"" || char === "'") {
      inQuote = char;
    } else if (/\s/u.test(char)) {
      if (current !== "") {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current !== "") args.push(current);
  return args;
}

function substituteArgs(content: string, args: string[]): string {
  const allArgs = args.join(" ");
  return content.replace(/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/gu, (_match, defaultTarget: string | undefined, defaultValue: string | undefined, sliceStart: string | undefined, sliceLength: string | undefined, simple: string | undefined) => {
    if (defaultTarget !== undefined) {
      const value = defaultTarget === "@" || defaultTarget === "ARGUMENTS" ? allArgs : args[Number.parseInt(defaultTarget, 10) - 1];
      return value !== undefined && value !== "" ? value : defaultValue ?? "";
    }
    if (sliceStart !== undefined) {
      const start = Math.max(0, Number.parseInt(sliceStart, 10) - 1);
      if (sliceLength !== undefined) return args.slice(start, start + Number.parseInt(sliceLength, 10)).join(" ");
      return args.slice(start).join(" ");
    }
    if (simple === "ARGUMENTS" || simple === "@") return allArgs;
    if (simple !== undefined) return args[Number.parseInt(simple, 10) - 1] ?? "";
    return "";
  });
}
