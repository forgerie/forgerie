/**
 * A message part's `parentId` starts with this when the part belongs to a
 * step: one assistant message that calls a tool. The rest is the message id.
 * The transcript writes it and the reply view reads it.
 */
export const STEP_PREFIX = "step:";
