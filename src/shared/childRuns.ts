import { Type, type Static } from "typebox";

export const CHILD_RUN_RETENTION_DAYS = 90;
const text = Type.String({ minLength: 1 });
const count = Type.Integer({ minimum: 0 });
const amount = Type.Number({ minimum: 0 });
const model = Type.Object({ provider: text, modelId: text });
export const ChildRunUsageSchema = Type.Object({
  input: count, output: count, cacheRead: count, cacheWrite: count, totalTokens: count,
  cacheWrite1h: Type.Optional(count), reasoning: Type.Optional(count),
  cost: Type.Object({ input: amount, output: amount, cacheRead: amount, cacheWrite: amount, total: amount }),
});
export const ChildRunUsageStateSchema = Type.Object({
  models: Type.Record(Type.String(), ChildRunUsageSchema), tools: Type.Record(Type.String(), ChildRunUsageSchema),
});
export const ChildRunSchema = Type.Object({
  id: text,
  workflowRunId: Type.Optional(text),
  session: Type.Object({ id: text, cwd: text }),
  child: Type.Object({ name: Type.String(), conversationId: Type.Integer({ minimum: 1 }), agent: Type.Union([text, Type.Null()]),
    agentFile: Type.Optional(Type.Object({ path: text, sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }) })) }),
  model: Type.Union([model, Type.Null()]),
  startedAt: count,
  state: Type.Union([
    Type.Object({ kind: Type.Literal("running") }),
    Type.Object({ kind: Type.Literal("finished"),
      outcome: Type.Union([Type.Literal("answered"), Type.Literal("failed"), Type.Literal("stopped")]),
      finishedAt: count, durationMs: count,
      timing: Type.Union([Type.Literal("observed"), Type.Literal("recovered")]),
    }),
  ]),
  turns: count,
  usage: Type.Union([ChildRunUsageStateSchema, Type.Null()]),
});
export type ChildRun = Static<typeof ChildRunSchema>;
export const ChildRunListSchema = Type.Object({ retentionDays: Type.Literal(CHILD_RUN_RETENTION_DAYS), records: Type.Array(ChildRunSchema) });
export const ChildRunFilterSchema = Type.Object({ session: Type.Optional(text), agent: Type.Optional(text) }, { additionalProperties: false });
export type ChildRunFilter = Static<typeof ChildRunFilterSchema>;
