import type { ThinkingLevel } from "../../shared/thinkingLevels.js";
import type { TriggerAction } from "../../shared/triggers.js";

// The frozen shared schema uses a mapped (non-tuple) Type.Union. TypeBox's Static resolves
// that optional thinkingLevel to undefined, although runtime validation accepts every level.
export type TriggerSessionAction = Omit<TriggerAction, "thinkingLevel"> & { thinkingLevel?: ThinkingLevel };
