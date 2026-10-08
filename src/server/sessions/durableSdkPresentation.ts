import type { BashOperations, BuildSystemPromptOptions, PromptTemplate } from "@earendil-works/pi-coding-agent";

/** These SDK helpers are not root exports. Pin the SDK and exercise this seam on every upgrade. */
async function sdkModule(relative: string): Promise<unknown> {
  const url = new URL(relative, import.meta.resolve("@earendil-works/pi-coding-agent")).href;
  const loaded: unknown = await import(url);
  return loaded;
}
const promptModule = sdkModule("./core/system-prompt.js");
const templateModule = sdkModule("./core/prompt-templates.js");
const bashModule = sdkModule("./core/bash-executor.js");

async function invoke(module: Promise<unknown>, name: string, args: readonly unknown[]): Promise<unknown> {
  const loaded = await module;
  if (typeof loaded !== "object" || loaded === null) throw new Error("Pinned SDK helper module is not an object");
  const callable: unknown = Reflect.get(loaded, name);
  if (typeof callable !== "function") throw new Error(`Pinned SDK lost ${name}`);
  const result: unknown = Reflect.apply(callable, undefined, args);
  return result;
}

export async function buildSdkSystemPrompt(options: BuildSystemPromptOptions): Promise<string> {
  const result = await invoke(promptModule, "buildSystemPrompt", [options]);
  if (typeof result !== "string") throw new Error("SDK system prompt must be text");
  return result;
}

export async function expandSdkPrompt(text: string, templates: readonly PromptTemplate[]): Promise<string> {
  const result = await invoke(templateModule, "expandPromptTemplate", [text, templates]);
  if (typeof result !== "string") throw new Error("SDK prompt expansion must be text");
  return result;
}

export interface SdkBashResult {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
}

export async function executeSdkBash(command: string, cwd: string, operations: BashOperations, options: { signal: AbortSignal; onChunk?: (chunk: string) => void }): Promise<SdkBashResult> {
  const result = await invoke(bashModule, "executeBashWithOperations", [command, cwd, operations, options]);
  if (typeof result !== "object" || result === null || !("output" in result) || typeof result.output !== "string"
    || !("exitCode" in result) || (result.exitCode !== undefined && typeof result.exitCode !== "number")
    || !("cancelled" in result) || typeof result.cancelled !== "boolean" || !("truncated" in result) || typeof result.truncated !== "boolean") {
    throw new Error("SDK bash result does not match the pinned contract");
  }
  return { output: result.output, exitCode: result.exitCode, cancelled: result.cancelled, truncated: result.truncated,
    ...("fullOutputPath" in result && typeof result.fullOutputPath === "string" ? { fullOutputPath: result.fullOutputPath } : {}) };
}
