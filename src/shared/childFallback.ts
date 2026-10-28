import { Type, type Static } from "typebox";

/** A committed model change. Reason is the provider's actual error, not a replacement error code. */
export const ChildFallbackSchema = Type.Object({ from: Type.String(), to: Type.String(), reason: Type.String() }, { additionalProperties: false });
export type ChildFallback = Static<typeof ChildFallbackSchema>;
