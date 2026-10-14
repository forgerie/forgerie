import { createHash } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { TriggerActionSchema, TriggerCreateSchema, TriggerIdSchema, TriggerUpdateSchema, TriggerRunRequestSchema, type Trigger } from "../../shared/triggers.js";
import { TriggerScheduleSchema } from "../../shared/triggerSchedules.js";
import type { TriggerService } from "./triggerService.js";

const schedule = Type.Union([
  Type.Object({ ...TriggerScheduleSchema.anyOf[0].properties, timezone: Type.Optional(TriggerScheduleSchema.anyOf[0].properties.timezone) }, { additionalProperties: false }),
  Type.Object({ ...TriggerScheduleSchema.anyOf[1].properties, timezone: Type.Optional(TriggerScheduleSchema.anyOf[1].properties.timezone) }, { additionalProperties: false }),
]);
const create = Type.Object({ ...TriggerCreateSchema.properties, schedule,
  action: Type.Object({ ...TriggerActionSchema.properties, targets: Type.Optional(TriggerActionSchema.properties.targets) }, { additionalProperties: false }),
}, { additionalProperties: false });
const parameters = Type.Union([
  Type.Object({ action: Type.Literal("list") }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("create"), trigger: create }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("update"), id: TriggerIdSchema, changes: TriggerUpdateSchema }, { additionalProperties: false }),
  Type.Object({ action: Type.Union([Type.Literal("pause"), Type.Literal("resume"), Type.Literal("delete")]), id: TriggerIdSchema }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("run"), id: TriggerIdSchema, requestId: Type.Optional(TriggerRunRequestSchema.properties.requestId) }, { additionalProperties: false }),
]);

function nextFire(trigger: Trigger): string {
  if (trigger.state.kind === "paused") return "Paused. No scheduled run until resumed.";
  const at = new Date(trigger.state.nextFireAt);
  return `Next run ${new Intl.DateTimeFormat("en-US", { timeZone: trigger.schedule.timezone, dateStyle: "full", timeStyle: "long" }).format(at)} (${at.toISOString()}).`;
}
// DurableSdkTools registers every SDK custom tool with replay: "unsafe".
export function createWorkflowScheduleTool(cwd: string, service: () => TriggerService) {
  return defineTool({
    name: "workflow_schedule", label: "Workflow schedule", executionMode: "sequential",
    description: "List, create, update, pause, resume, delete, or run scheduled saved prose workflows of the calling session's project only. Create directly; each fire costs a full workflow run. Create uses trigger, update uses changes and baseRevision. Defaults target projects to this session and timezone to the host. Run now also works when paused and leaves the next scheduled run unchanged. Deleting removes history but keeps sessions.",
    parameters,
    async execute(callId, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const triggers = service();
      let value: unknown;
      let words = "";
      if (params.action === "list") {
        const list = await triggers.list(cwd);
        value = list;
        words = list.triggers.map((trigger) => `${trigger.name}: ${nextFire(trigger)}`).join("\n");
      } else if (params.action === "delete") { await triggers.remove(params.id, cwd); value = { ok: true }; }
      else if (params.action === "run") {
        value = await triggers.run(params.id, { requestId: params.requestId ?? createHash("sha256").update(callId).digest("hex") }, cwd);
        words = nextFire(await triggers.get(params.id, cwd));
      } else {
        let trigger: Trigger;
        if (params.action === "create") trigger = await triggers.create({ ...params.trigger, action: { ...params.trigger.action, targets: params.trigger.action.targets ?? { kind: "projects", cwds: [cwd] } }, schedule: { ...params.trigger.schedule, timezone: params.trigger.schedule.timezone ?? triggers.timezone } }, { kind: "agent", sessionId: ctx.sessionManager.getSessionId(), cwd }, cwd);
        else if (params.action === "update") trigger = await triggers.update(params.id, params.changes, cwd);
        else trigger = await triggers[params.action](params.id, cwd);
        value = trigger;
        words = nextFire(trigger);
      }
      return { content: [{ type: "text", text: `${JSON.stringify(value)}${words === "" ? "" : `\n${words}`}` }], details: undefined };
    },
  });
}
