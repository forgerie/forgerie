import { Type, type Static } from "typebox";

/** One wire contract for the daemon and both clients. No client infers intent from text. */
export const SessionResponseSchema = Type.Union([
  Type.Object({ kind: Type.Literal("none") }),
  Type.Object({ kind: Type.Literal("needs-response"), reason: Type.Union([
    Type.Literal("reply"), Type.Literal("questions"), Type.Literal("undeclared"),
  ]) }),
]);
export type SessionResponse = Static<typeof SessionResponseSchema>;
