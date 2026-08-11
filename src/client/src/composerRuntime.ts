import { api, workspacesApi, type SessionModel, type SlashCommand } from "./api";
import type { PromptResourceCommandDescriptor } from "../../shared/promptResourceCommand";
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

export type PreSessionPromptResourceCatalogResolver = (projectId: string, workspaceId: string, machineId: string) => Promise<Awaited<ReturnType<typeof workspacesApi.promptResourceCatalog>>>;

export interface PreSessionComposerRuntimeOptions {
  machineId: string;
  projectId?: string;
  workspaceId?: string;
  promptResourceCatalog?: PreSessionPromptResourceCatalogResolver;
}

export class ComposerCompletionProviderError extends Error {
  constructor(
    readonly kind: ComposerCompletionKind,
    message: string,
  ) {
    super(message);
    this.name = "ComposerCompletionProviderError";
  }
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
  const completeDestination = hasDestinationContext(options);
  return {
    supportedCompletionKinds: completeDestination ? new Set<ComposerCompletionKind>(["command", "file"]) : new Set<ComposerCompletionKind>(),
    async resolveCompletion(trigger: PromptCompletionTrigger): Promise<readonly CompletionItem[]> {
      if (!completeDestination) return [];
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
    .map((command) => formatCommandCompletion(command, trigger));
}

function formatCommandCompletion(command: SlashCommand | PromptResourceCommandDescriptor, trigger: Extract<PromptCompletionTrigger, { kind: "command" }>): CompletionItem {
  return {
    kind: "command",
    replaceFrom: trigger.from,
    replaceTo: trigger.to,
    insertText: `/${command.name}`,
    detail: command.source,
    ...("identity" in command ? { promptResourceCommandIdentity: command.identity } : {}),
    ...(command.description === undefined ? {} : { description: command.description }),
  };
}

async function resolvePreSessionCommands(trigger: Extract<PromptCompletionTrigger, { kind: "command" }>, options: PreSessionComposerRuntimeOptions): Promise<CompletionItem[]> {
  if (!hasDestinationContext(options)) return [];
  let catalog: Awaited<ReturnType<typeof workspacesApi.promptResourceCatalog>>;
  try {
    catalog = await (options.promptResourceCatalog ?? workspacesApi.promptResourceCatalog)(options.projectId, options.workspaceId, options.machineId);
  } catch (error) {
    throw new ComposerCompletionProviderError("command", errorMessage(error, "Prompt-resource catalog unavailable."));
  }
  if (!catalog.available) throw new ComposerCompletionProviderError("command", catalog.message);
  return catalog.commands
    .filter((command) => command.name.toLowerCase().includes(trigger.query.toLowerCase()))
    .slice(0, 12)
    .map((command) => formatCommandCompletion(command, trigger));
}

async function resolveWorkspaceFiles(trigger: Extract<PromptCompletionTrigger, { kind: "file" }>, options: SessionComposerRuntimeOptions): Promise<CompletionItem[]> {
  if (!hasDestinationContext(options)) return [];
  const files = await api.files(trigger.query, { scope: trigger.fileScope, machineId: options.machineId, projectId: options.projectId, workspaceId: options.workspaceId }).catch((error: unknown) => {
    throw new ComposerCompletionProviderError("file", errorMessage(error, "Workspace files unavailable."));
  });
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

function hasDestinationContext(options: PreSessionComposerRuntimeOptions): options is PreSessionComposerRuntimeOptions & { projectId: string; workspaceId: string } {
  return options.projectId !== undefined && options.projectId !== "" && options.workspaceId !== undefined && options.workspaceId !== "";
}

function emptySlashCommands(): SlashCommand[] {
  return [];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function emptySessionModels(): SessionModel[] {
  return [];
}
