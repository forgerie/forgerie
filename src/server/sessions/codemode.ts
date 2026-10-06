import { createCodemodeExtension, type InlineExtension, type ToolExposure } from "@earendil-works/pi-coding-agent";
import { CODEMODE_TOOL_NAME } from "../../shared/codemodeScript.js";

/**
 * Exposure for Forgerie tools that only work as the model's own call.
 *
 * They end the run (`ask_user`, `handoff_session`, `yield_to_subsessions`)
 * or start a session the transcript must show (`spawn_session`,
 * `spawn_subsession`). A script's call is not a transcript entry and cannot
 * end the run, so the model declares them while scripts never reach them.
 * `pi-subagents` declares `subagent` the same way.
 */
export const MODEL_ONLY_EXPOSURE: ToolExposure = "model-only";

/**
 * The extension that gives a hosted session the `codemode` tool.
 *
 * Pi's CLI loads codemode as the `builtin:codemode` extension. Loading it the
 * same way keeps the Pi profile in charge of it: `-builtin:codemode` in the
 * `extensions` setting removes it, and another extension that registers
 * `codemode` replaces it. Pi registers the tool inactive; see
 * {@link codemodeDefaultTools} for how Forgerie turns it on.
 */
export function hostedCodemodeExtension(): InlineExtension {
  return { name: CODEMODE_TOOL_NAME, factory: createCodemodeExtension(), replaceable: true, builtin: true };
}

/**
 * The `defaultTools` override that applies Forgerie's `codemode` setting.
 *
 * Only `+name`/`-name` entries, so the Pi profile's own tool selection is kept
 * and only `codemode` changes. Forgerie applies this in memory and never writes
 * it to the shared profile: Pi before 0.99 reads a `+codemode` entry as a plain
 * tool name and would start terminal sessions with no built-in tools.
 */
export function codemodeDefaultTools(enabled: boolean): string[] {
  return [`${enabled ? "+" : "-"}${CODEMODE_TOOL_NAME}`];
}

/**
 * Whether a session event belongs to a call that a tool made, not the model.
 *
 * Pi emits `tool_execution_*` for a script's calls with `parentToolCallId`
 * set, but records them only on the parent's tool result. They are progress of
 * the parent call, never transcript entries of their own.
 */
export function isNestedToolEvent(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const parent: unknown = Reflect.get(event, "parentToolCallId");
  return typeof parent === "string" && parent !== "";
}
