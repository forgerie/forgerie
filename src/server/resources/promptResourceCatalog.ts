import { BrowserFileAccess } from "../browserFileAccess.js";
import { join, resolve } from "node:path";
import { DefaultResourceLoader, type PromptTemplate, type ResourceDiagnostic, type Skill } from "@earendil-works/pi-coding-agent";
import { buildPromptResourceCatalogFromResources, type CanonicalSkillResourceInput } from "../sessions/commandCatalog.js";
import { canonicalPromptResourceOrigin } from "../sessions/promptResourceOrigin.js";
import { BUILTIN_COMMANDS } from "../sessions/builtinCommands.js";
import type { PromptResourceCatalogAvailable, PromptResourceCatalogResponse } from "../../shared/promptResourceCommand.js";
import { assertBoundedPromptResourceContent, PromptResourceContentLimitError, readBoundedPromptResourceFile } from "./promptResourceContent.js";

export interface PromptResourceCatalogLimits {
  maxCommands: number;
  maxNameLength: number;
  maxDescriptionLength: number;
  maxIdentityLength: number;
  maxSerializedBytes: number;
  activeLoads: number;
  queuedLoads: number;
  deadlineMs: number;
}

export const PROMPT_RESOURCE_CATALOG_LIMITS: Readonly<PromptResourceCatalogLimits> = Object.freeze({
  maxCommands: 1_000,
  maxNameLength: 128,
  maxDescriptionLength: 2_048,
  maxIdentityLength: 512,
  maxSerializedBytes: 2 * 1024 * 1024,
  activeLoads: 2,
  queuedLoads: 16,
  deadlineMs: 10_000,
});

export type PromptResourceCatalogUnavailableReason = Extract<PromptResourceCatalogResponse, { available: false }>["reason"];

interface LoadedPromptResources {
  prompts: readonly PromptTemplate[];
  skills: readonly Skill[];
  diagnostics: readonly ResourceDiagnostic[];
}

export interface PromptResourceLoader {
  loadResources(input: { cwd: string; agentDir: string; signal: AbortSignal }): Promise<LoadedPromptResources>;
}

export interface PromptResourceCatalogServiceOptions {
  agentDir: string;
  loader?: PromptResourceLoader;
  limits?: PromptResourceCatalogLimits;
}

interface QueuedLoad {
  key: string;
  cwd: string;
  deadlineAt: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (response: PromptResourceCatalogResponse) => void;
}

export class PromptResourceCatalogService {
  private readonly agentDir: string;
  private readonly loader: PromptResourceLoader;
  private readonly limits: PromptResourceCatalogLimits;
  private readonly inFlight = new Map<string, Promise<PromptResourceCatalogResponse>>();
  private readonly queue: QueuedLoad[] = [];
  private activeLoads = 0;

  constructor(options: PromptResourceCatalogServiceOptions) {
    this.agentDir = resolve(options.agentDir);
    this.loader = options.loader ?? createDefaultPromptResourceLoader();
    this.limits = options.limits ?? PROMPT_RESOURCE_CATALOG_LIMITS;
  }

  catalog(cwd: string): Promise<PromptResourceCatalogResponse> {
    const canonicalCwd = resolve(cwd);
    const key = `${this.agentDir}\u0000${canonicalCwd}`;
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing;
    if (this.activeLoads < this.limits.activeLoads) return this.start(key, canonicalCwd);
    if (this.queue.length >= this.limits.queuedLoads) return Promise.resolve(promptResourceCatalogUnavailable("busy", "Prompt-resource catalog loading is busy."));

    const queued = new Promise<PromptResourceCatalogResponse>((resolveQueued) => {
      const expire = () => {
        const queuedLoad = this.queue.find((candidate) => candidate.key === key);
        if (queuedLoad !== undefined) this.expireQueued(queuedLoad);
      };
      const queuedLoad: QueuedLoad = {
        key,
        cwd: canonicalCwd,
        deadlineAt: Date.now() + this.limits.deadlineMs,
        timeout: setTimeout(expire, this.limits.deadlineMs),
        resolve: resolveQueued,
      };
      this.queue.push(queuedLoad);
    });
    this.inFlight.set(key, queued);
    return queued;
  }

  private start(key: string, cwd: string, deadlineMs = this.limits.deadlineMs): Promise<PromptResourceCatalogResponse> {
    this.activeLoads += 1;
    const controller = new AbortController();
    const operation = this.load(cwd, controller.signal);
    const response = this.responseWithDeadline(operation, deadlineMs, () => { controller.abort(); });
    this.inFlight.set(key, response);
    void operation.finally(() => {
      this.activeLoads -= 1;
      this.inFlight.delete(key);
      this.drain();
    });
    return response;
  }

  private drain(): void {
    while (this.activeLoads < this.limits.activeLoads) {
      const next = this.queue.shift();
      if (next === undefined) return;
      clearTimeout(next.timeout);
      const remainingMs = next.deadlineAt - Date.now();
      if (remainingMs <= 0) {
        this.inFlight.delete(next.key);
        next.resolve(promptResourceCatalogTimeout());
        continue;
      }
      const response = this.start(next.key, next.cwd, remainingMs);
      response.then(next.resolve, () => { next.resolve(promptResourceCatalogUnavailable("error", "Prompt-resource catalog loading failed.")); });
    }
  }

  private expireQueued(load: QueuedLoad): void {
    const index = this.queue.indexOf(load);
    if (index === -1) return;
    this.queue.splice(index, 1);
    this.inFlight.delete(load.key);
    load.resolve(promptResourceCatalogTimeout());
  }

  private responseWithDeadline(operation: Promise<PromptResourceCatalogResponse>, deadlineMs: number, onTimeout: () => void): Promise<PromptResourceCatalogResponse> {
    return new Promise<PromptResourceCatalogResponse>((resolveResponse) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        resolved = true;
        onTimeout();
        resolveResponse(promptResourceCatalogTimeout());
      }, deadlineMs);

      operation.then((response) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolveResponse(response);
      }, () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolveResponse(promptResourceCatalogUnavailable("error", "Prompt-resource catalog loading failed."));
      });
    });
  }

  private async load(cwd: string, signal: AbortSignal): Promise<PromptResourceCatalogResponse> {
    try {
      const resources = await this.loader.loadResources({ cwd, agentDir: this.agentDir, signal });
      throwIfAborted(signal);
      const browserFiles = new BrowserFileAccess(this.agentDir);
      const readablePrompts = (await Promise.all(resources.prompts.map(async prompt => ({ prompt, readable: await browserFiles.isReadable(prompt.filePath) })))).filter(row => row.readable).map(row => row.prompt);
      const prompts = readablePrompts.map((prompt) => {
        assertBoundedPromptResourceContent(prompt.content, this.limits.maxSerializedBytes);
        return {
          name: prompt.name,
          description: prompt.description,
          content: prompt.content,
          origin: canonicalPromptResourceOrigin("prompt", prompt.filePath, prompt.sourceInfo),
        };
      });
      const skills: CanonicalSkillResourceInput[] = [];
      for (const skill of resources.skills) {
        if (!await browserFiles.isReadable(skill.filePath)) continue;
        skills.push({
          name: skill.name,
          description: skill.description,
          content: await readBoundedPromptResourceFile(skill.filePath, this.limits.maxSerializedBytes, signal, browserFiles),
          origin: canonicalPromptResourceOrigin("skill", skill.filePath, skill.sourceInfo),
          baseDir: skill.baseDir,
          filePath: skill.filePath,
        });
      }
      const catalog = await buildPromptResourceCatalogFromResources({
        builtins: BUILTIN_COMMANDS.map((command) => ({ name: command.name, source: "builtin" as const, ...(command.description === undefined ? {} : { description: command.description }) })),
        prompts,
        skills,
        diagnostics: (await Promise.all(resources.diagnostics.map(async diagnostic => ({ diagnostic, readable: (await Promise.all([diagnostic.path, diagnostic.collision?.winnerPath, diagnostic.collision?.loserPath].filter(path => path !== undefined).map(path => browserFiles.isReadable(path)))).every(Boolean) })))).filter(row => row.readable).map(row => safeDiagnostic(row.diagnostic)),
      });
      return enforcePromptResourceCatalogLimits(catalog, this.limits);
    } catch (error) {
      if (error instanceof PromptResourceContentLimitError) {
        return promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog contained over-limit resource content.");
      }
      return promptResourceCatalogUnavailable("error", "Prompt-resource catalog loading failed.");
    }
  }
}

export function createDefaultPromptResourceLoader(): PromptResourceLoader {
  return {
    async loadResources({ cwd, agentDir, signal }) {
      throwIfAborted(signal);
      const browserFiles = new BrowserFileAccess(agentDir);
      await browserFiles.assertReadable(join(agentDir, "settings.json"));
      await browserFiles.assertReadable(join(cwd, ".pi", "settings.json"));
      throwIfAborted(signal);
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        noExtensions: true,
        noThemes: true,
        noContextFiles: true,
        additionalExtensionPaths: [],
        additionalThemePaths: [],
        extensionFactories: [],
      });
      await loader.reload();
      throwIfAborted(signal);
      const prompts = loader.getPrompts();
      const skills = loader.getSkills();
      return { prompts: prompts.prompts, skills: skills.skills, diagnostics: [...prompts.diagnostics, ...skills.diagnostics] };
    },
  };
}

export function enforcePromptResourceCatalogLimits(response: PromptResourceCatalogResponse, limits: PromptResourceCatalogLimits = PROMPT_RESOURCE_CATALOG_LIMITS): PromptResourceCatalogResponse {
  if (!response.available) return response;
  if (response.commands.length > limits.maxCommands) return promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog exceeded the command limit.");
  for (const command of response.commands) {
    if (command.name.length > limits.maxNameLength) return promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog contained an over-limit command name.");
    if ((command.description?.length ?? 0) > limits.maxDescriptionLength) return promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog contained an over-limit description.");
    if (JSON.stringify(command.identity).length > limits.maxIdentityLength || command.identity.fingerprint.length > limits.maxIdentityLength) {
      return promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog contained an over-limit identity.");
    }
  }
  if (serializedByteLength(response) > limits.maxSerializedBytes) return promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog exceeded the response size limit.");
  return response;
}

export function promptResourceCatalogUnavailable(reason: PromptResourceCatalogUnavailableReason, message: string): PromptResourceCatalogResponse {
  return { available: false, reason, message };
}

function promptResourceCatalogTimeout(): PromptResourceCatalogResponse {
  return promptResourceCatalogUnavailable("timeout", "Prompt-resource catalog loading timed out after 10 seconds; the loader will finish in the background.");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Prompt-resource catalog loading aborted.");
}

function serializedByteLength(response: PromptResourceCatalogAvailable): number {
  return Buffer.byteLength(JSON.stringify(response), "utf8");
}

function safeDiagnostic(diagnostic: ResourceDiagnostic): string {
  const type = diagnostic.type;
  const message = sanitizeDiagnosticText(diagnostic.message !== "" ? diagnostic.message : diagnostic.collision?.name ?? "resource diagnostic");
  return `${type}: ${message}`;
}

function sanitizeDiagnosticText(input: string): string {
  return input
    .replace(/[A-Za-z]:[\\/](?:[^\\/\s]+[\\/])*[^\\/\s]*/gu, "[path]")
    .replace(/(?:\/[A-Za-z0-9._@%+-]+)+/gu, "[path]");
}
