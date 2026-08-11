import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { DefaultResourceLoader, type PromptTemplate, type ResourceDiagnostic, type Skill, type SourceInfo } from "@earendil-works/pi-coding-agent";
import { buildPromptResourceCatalogFromResources } from "../sessions/commandCatalog.js";
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
  loadResources(input: { cwd: string; agentDir: string }): Promise<LoadedPromptResources>;
}

export interface PromptResourceCatalogServiceOptions {
  agentDir: string;
  loader?: PromptResourceLoader;
  limits?: PromptResourceCatalogLimits;
}

interface QueuedLoad {
  key: string;
  cwd: string;
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
      this.queue.push({ key, cwd: canonicalCwd, resolve: resolveQueued });
    });
    this.inFlight.set(key, queued);
    return queued;
  }

  private start(key: string, cwd: string): Promise<PromptResourceCatalogResponse> {
    this.activeLoads += 1;
    const operation = this.load(cwd);
    const response = this.responseWithDeadline(operation);
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
      const response = this.start(next.key, next.cwd);
      response.then(next.resolve, () => { next.resolve(promptResourceCatalogUnavailable("error", "Prompt-resource catalog loading failed.")); });
    }
  }

  private responseWithDeadline(operation: Promise<PromptResourceCatalogResponse>): Promise<PromptResourceCatalogResponse> {
    return new Promise<PromptResourceCatalogResponse>((resolveResponse) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        resolved = true;
        resolveResponse(promptResourceCatalogUnavailable("timeout", "Prompt-resource catalog loading timed out after 10 seconds; the loader will finish in the background."));
      }, this.limits.deadlineMs);

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

  private async load(cwd: string): Promise<PromptResourceCatalogResponse> {
    try {
      const resources = await this.loader.loadResources({ cwd, agentDir: this.agentDir });
      const catalog = await buildPromptResourceCatalogFromResources({
        prompts: resources.prompts.map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          content: prompt.content,
          origin: safeOrigin("prompt", prompt.filePath, prompt.sourceInfo),
        })),
        skills: await Promise.all(resources.skills.map(async (skill) => ({
          name: skill.name,
          description: skill.description,
          content: await readFile(skill.filePath, "utf8"),
          origin: safeOrigin("skill", skill.filePath, skill.sourceInfo),
          baseDir: skill.baseDir,
          filePath: skill.filePath,
        }))),
        diagnostics: resources.diagnostics.map(safeDiagnostic),
      });
      return enforcePromptResourceCatalogLimits(catalog, this.limits);
    } catch {
      return promptResourceCatalogUnavailable("error", "Prompt-resource catalog loading failed.");
    }
  }
}

export function createDefaultPromptResourceLoader(): PromptResourceLoader {
  return {
    async loadResources({ cwd, agentDir }) {
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

function serializedByteLength(response: PromptResourceCatalogAvailable): number {
  return Buffer.byteLength(JSON.stringify(response), "utf8");
}

function safeOrigin(kind: "prompt" | "skill", filePath: string | undefined, sourceInfo: SourceInfo | undefined): string {
  return `${kind}:${sourceInfo?.scope ?? "unknown"}:${sourceInfo?.origin ?? "unknown"}:${sourceInfo?.source ?? "unknown"}:${filePath === undefined ? "unknown" : basename(filePath)}`;
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
