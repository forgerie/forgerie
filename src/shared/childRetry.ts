import { Type, type Static } from "typebox";

/** A reporter's durable backoff, not the provider's own in-request retries. */
export const ChildRetrySchema = Type.Object({
  attempt: Type.Integer({ minimum: 1, maximum: 3 }),
  max: Type.Literal(3),
  error: Type.String(),
  until: Type.Number(),
}, { additionalProperties: false });
export type ChildRetry = Static<typeof ChildRetrySchema>;
