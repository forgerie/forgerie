import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Check } from "typebox/value";
import { BacklogConfigSchema } from "../../shared/backlog.js";
import { effectiveUploadsConfig, parsePathAccessConfig, parseUploadsConfig, type PiWebConfig } from "../../config.js";
import type { BacklogConfig, PiWebPathAccessConfig, PiWebUploadsConfig } from "../../shared/apiTypes.js";

export const PROJECT_PI_WEB_CONFIG_PATH = ".forgerie/config.json";

export interface ProjectPiWebConfig {
  version?: 1;
  backlog?: BacklogConfig;
  pathAccess?: PiWebPathAccessConfig;
  uploads?: PiWebUploadsConfig;
}

export interface LoadedProjectPiWebConfig {
  path: string;
  exists: boolean;
  config: ProjectPiWebConfig;
  /**
   * Why the `backlog` section was left out. Only the backlog reports it: a backlog mistake
   * must not stop the project's workspaces from opening.
   */
  backlogError?: string;
}

export async function loadProjectPiWebConfig(projectPath: string): Promise<LoadedProjectPiWebConfig> {
  const path = join(projectPath, PROJECT_PI_WEB_CONFIG_PATH);
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed)) throw new Error(`Forgerie project config must be a JSON object: ${path}`);
    const { backlog, ...rest } = parsed;
    const config = parseProjectPiWebConfig(rest, path);
    if (backlog === undefined) return { path, exists: true, config };
    try { return { path, exists: true, config: { ...config, backlog: parseBacklogConfig(backlog, path) } }; }
    catch (error) { return { path, exists: true, config, backlogError: error instanceof Error ? error.message : String(error) }; }
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) return { path, exists: false, config: {} };
    throw error;
  }
}

export async function loadEffectiveProjectPathAccess(projectPath: string, globalConfig: PiWebConfig): Promise<PiWebPathAccessConfig | undefined> {
  const projectConfig = await loadProjectPiWebConfig(projectPath);
  return mergePathAccessConfigs(globalConfig.pathAccess, projectConfig.config.pathAccess);
}

export async function loadEffectiveProjectUploadsConfig(projectPath: string, globalConfig: PiWebConfig): Promise<PiWebUploadsConfig> {
  const projectConfig = await loadProjectPiWebConfig(projectPath);
  return effectiveUploadsConfig({ uploads: { ...(globalConfig.uploads ?? {}), ...(projectConfig.config.uploads ?? {}) } });
}

export function mergePathAccessConfigs(...configs: (PiWebPathAccessConfig | undefined)[]): PiWebPathAccessConfig | undefined {
  const allowedPaths = dedupe(configs.flatMap((config) => config?.allowedPaths ?? []));
  return allowedPaths.length === 0 ? undefined : { allowedPaths };
}

function parseProjectPiWebConfig(value: Record<string, unknown>, path: string): ProjectPiWebConfig {
  const version = value["version"];
  return {
    ...(version !== undefined ? { version: parseProjectConfigVersion(version, path) } : {}),
    ...(value["pathAccess"] !== undefined ? { pathAccess: parsePathAccessConfig(value["pathAccess"], path) } : {}),
    ...(value["uploads"] !== undefined ? { uploads: parseUploadsConfig(value["uploads"], path) } : {}),
  };
}

function parseBacklogConfig(value: unknown, path: string): BacklogConfig {
  const dir: unknown = isRecord(value) ? value["dir"] : undefined;
  if (dir !== undefined && (typeof dir !== "string" || isAbsolute(dir) || dir.split("/").includes("..") || /[\\\\\0]/.test(dir) || dir.trim() === "")) {
    // Someone once wrote ../work/items, reading the path as relative to .forgerie/. Say where it starts.
    throw new Error(`backlog.dir must be a non-empty path inside the project, written from the project root (work/items), not from .forgerie/: ${path}`);
  }
  if (!Check(BacklogConfigSchema, value)) {
    throw new Error(`backlog must be an object with optional dir, providers ("markdown", "github"), and github { repo: "owner/name", authors: "trusted" | "all" }: ${path}`);
  }
  return value;
}

function parseProjectConfigVersion(value: unknown, path: string): 1 {
  if (value !== 1) throw new Error(`Forgerie project config version must be 1: ${path}`);
  return 1;
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
