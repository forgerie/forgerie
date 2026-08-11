import { resolve } from "node:path";
import type { PromptResourceCommandSource } from "../../shared/promptResourceCommand.js";

export interface PromptResourceSourceInfo {
  source: string;
  scope: string;
  origin: string;
  path?: string | undefined;
}

export function canonicalPromptResourceOrigin(kind: PromptResourceCommandSource, filePath: string | undefined, sourceInfo: PromptResourceSourceInfo | undefined): string {
  const canonicalPath = sourceInfo?.path ?? filePath;
  return `${kind}:${sourceInfo?.scope ?? "unknown"}:${sourceInfo?.origin ?? "unknown"}:${sourceInfo?.source ?? "unknown"}:${canonicalPath === undefined ? "unknown" : resolve(canonicalPath)}`;
}
