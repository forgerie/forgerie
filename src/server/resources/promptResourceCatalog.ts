import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { DefaultResourceLoader, type PromptTemplate, type ResourceDiagnostic, type Skill } from "@earendil-works/pi-coding-agent";
import { buildPromptResourceCatalogFromResources, type CanonicalSkillResourceInput } from "../sessions/commandCatalog.js";
import { canonicalPromptResourceOrigin } from "../sessions/promptResourceOrigin.js";
import type { PromptResourceCatalogAvailable, PromptResourceCatalogResponse } from "../../shared/promptResourceCommand.js";

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

class PromptResourceContentLimitError extends Error {}

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

    let queuedLoad!: QueuedLoad;
    const queued = new Promise<PromptResourceCatalogResponse>((resolveQueued) => {
      queuedLoad = {
        key,
        cwd: canonicalCwd,
        deadlineAt: Date.now() + this.limits.deadlineMs,
        timeout: setTimeout(() => { this.expireQueued(queuedLoad); }, this.limits.deadlineMs),
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
      const prompts = resources.prompts.map((prompt) => {
        assertBoundedResourceContent(prompt.content, this.limits.maxSerializedBytes);
        return {
          name: prompt.name,
          description: prompt.description,
          content: prompt.content,
          origin: canonicalPromptResourceOrigin("prompt", prompt.filePath, prompt.sourceInfo),
        };
      });
      const skills: CanonicalSkillResourceInput[] = [];
      for (const skill of resources.skills) {
        skills.push({
          name: skill.name,
          description: skill.description,
          content: await readBoundedResourceFile(skill.filePath, this.limits.maxSerializedBytes, signal),
          origin: canonicalPromptResourceOrigin("skill", skill.filePath, skill.sourceInfo),
          baseDir: skill.baseDir,
          filePath: skill.filePath,
        });
      }
      const catalog = await buildPromptResourceCatalogFromResources({
        prompts,
        skills,
        diagnostics: resources.diagnostics.map(safeDiagnostic),
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

async function readBoundedResourceFile(filePath: string, maxBytes: number, signal: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const handle = await open(filePath, "r");
  try {
    const file = await handle.stat();
    if (!file.isFile() || file.size > maxBytes) throw new PromptResourceContentLimitError();
    const capacity = Math.min(maxBytes + 1, file.size + 1);
    const content = Buffer.alloc(Math.max(1, capacity));
    let offset = 0;
    while (offset < content.length) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(content, offset, content.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes || offset > file.size) throw new PromptResourceContentLimitError();
    return content.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

function assertBoundedResourceContent(content: string, maxBytes: number): void {
  if (Buffer.byteLength(content, "utf8") > maxBytes) throw new PromptResourceContentLimitError();
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
