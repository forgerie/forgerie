import { Type } from "typebox";

const count = Type.Integer({ minimum: 0 });
const amount = Type.Number({ minimum: 0 });

/** Validated pi.usage counters shared by parent statistics and child run records. */
export const DurableUsageSchema = Type.Object({
  input: count, output: count, cacheRead: count, cacheWrite: count, totalTokens: count,
  cacheWrite1h: Type.Optional(count), reasoning: Type.Optional(count),
  cost: Type.Object({ input: amount, output: amount, cacheRead: amount, cacheWrite: amount, total: amount }),
});
export const DurableUsageStateSchema = Type.Object({
  models: Type.Record(Type.String(), DurableUsageSchema), tools: Type.Record(Type.String(), DurableUsageSchema),
});
