import { api, workspacesApi, type FileSuggestion, type SessionModel, type SlashCommand } from "./api";
import { fileCompletionInsertText, modelCompletionChoices, type PromptCompletionTrigger } from "./promptCompletions";
import type { CompletionItem } from "./components/shared";

export type ComposerCompletionKind = PromptCompletionTrigger["kind"];

export interface ComposerRuntime {
  readonly supportedCompletionKinds: ReadonlySet<ComposerCompletionKind>;
  resolveCompletion(trigger: PromptCompletionTrigger): Promise<readonly CompletionItem[]>;
}

export interface SessionComposerRuntimeOptions {
  sessionId?: string;
  cwd?: string;
  machineId: string;
  projectId?: string;
  workspaceId?: string;
}

export interface PreSessionComposerRuntimeOptions {
  machineId: string;
  projectId?: string;
  workspaceId?: string;
}

export function createSessionComposerRuntime(options: SessionComposerRuntimeOptions): ComposerRuntime {
  return {
    supportedCompletionKinds: new Set<ComposerCompletionKind>(["command", "file", "model"]),
    async resolveCompletion(trigger: PromptCompletionTrigger): Promise<readonly CompletionItem[]> {
      if (trigger.kind === "command") return resolveSessionCommands(trigger, options);
      if (trigger.kind === "file") return resolveWorkspaceFiles(trigger, options);
      return resolveSessionModels(trigger, options);
    },
  };
}

export function createPreSessionComposerRuntime(options: PreSessionComposerRuntimeOptions): ComposerRuntime {
  return {
    supportedCompletionKinds: new Set<ComposerCompletionKind>(["command", "file"]),
    async resolveCompletion(trigger: PromptCompletionTrigger): Promise<readonly CompletionItem[]> {
      if (trigger.kind === "command") return resolvePreSessionCommands(trigger, options);
      if (trigger.kind === "file") return resolveWorkspaceFiles(trigger, options);
      return [];
    },
  };
}

async function resolveSessionCommands(trigger: Extract<PromptCompletionTrigger, { kind: "command" }>, options: SessionComposerRuntimeOptions): Promise<CompletionItem[]> {
  if (!hasSessionContext(options)) return [];
  const commands = await api.commands({ id: options.sessionId, cwd: options.cwd }, options.machineId).catch(emptySlashCommands);
  return commands
    .filter((command) => command.name.toLowerCase().includes(trigger.query.toLowerCase()))
    .slice(0, 12)
    .map((command) => ({
      kind: "command",
      replaceFrom: trigger.from,
      replaceTo: trigger.to,
      insertText: `/${command.name}`,
      detail: command.source,
      ...(command.description === undefined ? {} : { description: command.description }),
    }));
}

async function resolvePreSessionCommands(trigger: Extract<PromptCompletionTrigger, { kind: "command" }>, options: PreSessionComposerRuntimeOptions): Promise<CompletionItem[]> {
  if (options.projectId === undefined || options.workspaceId === undefined) return [];
  const catalog = await workspacesApi.promptResourceCatalog(options.projectId, options.workspaceId, options.machineId).catch(() => undefined);
  if (catalog?.available !== true) return [];
  return catalog.commands
    .filter((command) => command.name.toLowerCase().includes(trigger.query.toLowerCase()))
    .slice(0, 12)
    .map((command) => ({
      kind: "command",
      replaceFrom: trigger.from,
      replaceTo: trigger.to,
      insertText: `/${command.name}`,
      detail: command.source,
      ...(command.description === undefined ? {} : { description: command.description }),
    }));
}

async function resolveWorkspaceFiles(trigger: Extract<PromptCompletionTrigger, { kind: "file" }>, options: SessionComposerRuntimeOptions): Promise<CompletionItem[]> {
  if (options.projectId === undefined || options.workspaceId === undefined) return [];
  const files = await api.files(trigger.query, { scope: trigger.fileScope, machineId: options.machineId, projectId: options.projectId, workspaceId: options.workspaceId }).catch(emptyFileSuggestions);
  return files
    .slice(0, 12)
    .map((file) => {
      const insertText = fileCompletionInsertText(file.path, trigger.quoted === true, file.path.endsWith("/") ? trigger.allPrefix : undefined);
      return {
        kind: "file",
        replaceFrom: trigger.from,
        replaceTo: trigger.to,
        insertText,
        detail: file.kind,
        ...(file.path.endsWith("/") && insertText.endsWith("\"") ? { cursorOffset: insertText.length - 1 } : {}),
      };
    });
}

async function resolveSessionModels(trigger: Extract<PromptCompletionTrigger, { kind: "model" }>, options: SessionComposerRuntimeOptions): Promise<CompletionItem[]> {
  if (!hasSessionContext(options)) return [];
  const models = await api.models({ id: options.sessionId, cwd: options.cwd }, options.machineId).then((response) => response.models).catch(emptySessionModels);
  return modelCompletionChoices(models, trigger.query).map((choice) => ({
    kind: "model",
    replaceFrom: trigger.from,
    replaceTo: trigger.to,
    ...choice,
  }));
}

function hasSessionContext(options: SessionComposerRuntimeOptions): options is SessionComposerRuntimeOptions & { sessionId: string; cwd: string } {
  return options.sessionId !== undefined && options.sessionId !== "" && options.cwd !== undefined && options.cwd !== "";
}

function emptySlashCommands(): SlashCommand[] {
  return [];
}

function emptyFileSuggestions(): FileSuggestion[] {
  return [];
}

function emptySessionModels(): SessionModel[] {
  return [];
}
