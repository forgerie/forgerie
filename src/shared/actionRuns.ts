import { Type, type Static } from "typebox";
import { PullRefSchema, PullWatchSchema } from "./pullRequests.js";

const text = Type.String();
const id = Type.Integer({ minimum: 1 });
const date = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T" });
export const ActionRunLinkSchema = Type.Object({
  provider: Type.Literal("github"), session: PullRefSchema, repo: text, runId: id,
  source: Type.Union([Type.Literal("manual"), Type.Literal("dispatch"), Type.Literal("pull")]), watch: PullWatchSchema,
});
export type ActionRunLink = Static<typeof ActionRunLinkSchema>;
export const ActionJobSchema = Type.Object({
  id, name: text, state: Type.Union([Type.Literal("queued"), Type.Literal("running"), Type.Literal("passed"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("skipped")]), url: text,
  startedAt: Type.Optional(date), completedAt: Type.Optional(date), seconds: Type.Optional(Type.Number({ minimum: 0 })),
  logTail: Type.Optional(text), logSource: Type.Optional(Type.Literal("annotations")),
});
export type ActionJob = Static<typeof ActionJobSchema>;
export const ActionRunSchema = Type.Object({
  repo: text, runId: id, attempt: id, workflow: text, workflowPath: text, title: text, event: text, branch: text, headSha: text, actor: text, url: text,
  status: Type.Union([Type.Literal("queued"), Type.Literal("waiting"), Type.Literal("running"), Type.Literal("completed")]),
  conclusion: Type.Union([Type.Null(), Type.Literal("success"), Type.Literal("failure"), Type.Literal("cancelled"), Type.Literal("skipped"), Type.Literal("timed_out"), Type.Literal("action_required"), Type.Literal("neutral"), Type.Literal("stale")]),
  createdAt: date, updatedAt: date, pullNumbers: Type.Array(id), jobs: Type.Array(ActionJobSchema), complete: Type.Boolean(),
});
export type ActionRun = Static<typeof ActionRunSchema>;
export const SessionActionRunsResponseSchema = Type.Object({
  items: Type.Array(Type.Object({ link: ActionRunLinkSchema, run: Type.Union([ActionRunSchema, Type.Null()]), error: Type.Optional(text) })),
  derived: Type.Array(Type.Object({ pull: id, headSha: text, runs: Type.Array(ActionRunSchema), error: Type.Optional(text) })),
});
export type SessionActionRunsResponse = Static<typeof SessionActionRunsResponseSchema>;
export const SessionActionRunResponseSchema = Type.Object({ link: ActionRunLinkSchema, run: ActionRunSchema });
export const ActionRunErrorSchema = Type.Object({ kind: Type.Literal("action_run_error"), error: text });
