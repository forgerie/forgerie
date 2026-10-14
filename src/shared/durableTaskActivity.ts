import { z } from "zod";

const taskRow = z.strictObject({
  id: z.number().int(),
  kind: z.string(),
  label: z.string(),
  subject: z.string().max(120).nullable(),
  conversationId: z.number().int(),
  owner: z.number().int().nullable(),
  agentConversationId: z.number().int().nullable(),
  group: z.enum(["this-turn", "background"]),
  background: z.boolean(),
  status: z.enum(["pending", "running", "waiting", "completing", "blocked"]),
  waitingOn: z.number().int().nonnegative(),
  blockedReason: z.enum(["missing_task", "task_too_old", "migration_failed"]).nullable(),
  scheduler: z.string(),
  startedAt: z.number().nullable(),
  tool: z.strictObject({ name: z.string(), replay: z.enum(["safe", "unsafe"]) }).nullable(),
  restart: z.enum(["resumes", "stops", "blocked", "unknown"]),
});
const taskAgent = z.strictObject({
  conversationId: z.number().int(),
  name: z.string(),
  taskId: z.number().int().nullable(),
});
export const taskActivitySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("unsupported") }),
  z.strictObject({
    kind: z.literal("ready"),
    parentConversationId: z.number().int(),
    backgroundAgents: z.number().int().nonnegative(),
    agents: z.array(taskAgent),
    tasks: z.array(taskRow),
  }),
]);
export type TaskActivity = z.infer<typeof taskActivitySchema>;
