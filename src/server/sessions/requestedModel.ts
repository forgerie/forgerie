import { parseModelReference, type ThinkingLevel } from "../../shared/thinkingLevels.js";

/** How the session-starting tools describe their `model` parameter to the agent. */
export function modelParameterDescription(subject: string): string {
  return `Model for ${subject}, as an exact "provider/model-id" such as "anthropic/claude-sonnet-4-5", optionally with a thinking level after a colon, `
    + `such as "anthropic/claude-sonnet-4-5:high". When the user references a model as #provider/model-id or #provider/model-id:level in their request, `
    + "forward it here exactly, level included. An unknown model is rejected. Omit to inherit this session's model and thinking level.";
}

/**
 * The model and thinking level a session-starting tool forwards. A level written
 * on the requested model wins; otherwise the current session's level carries over.
 */
export function requestedModel(model: string | undefined, inherited: ThinkingLevel | undefined): { modelSpec?: string; thinkingLevel?: ThinkingLevel } {
  const reference = model === undefined ? undefined : parseModelReference(model);
  const thinkingLevel = reference?.thinkingLevel ?? inherited;
  return { ...(reference === undefined ? {} : { modelSpec: reference.model }), ...(thinkingLevel === undefined ? {} : { thinkingLevel }) };
}
