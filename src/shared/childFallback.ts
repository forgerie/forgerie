import { childModelDiagnostic } from "./childModelDiagnostic.js";
import { Type, type Static } from "typebox";

/** A committed model change. Reason is a redacted, bounded provider diagnostic. */
export const ChildFallbackSchema = Type.Object({ from: Type.String(), to: Type.String(), reason: Type.String() }, { additionalProperties: false });
export type ChildFallback = Static<typeof ChildFallbackSchema>;

export function childFallbackDiagnostic(fallback: ChildFallback): ChildFallback {
  return { ...fallback, reason: childModelDiagnostic(fallback.reason) };
}
