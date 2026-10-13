import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import type { TriggerAction } from "../../shared/triggers.js";
import type { PiSessionService } from "../sessions/piSessionService.js";
import { TriggerFireError, type FireTrigger, type TriggerFireRequest } from "./durableTriggers.js";

/** The UUID's clock is the occurrence, not restart time. Its entropy is the request receipt key. */
export function triggerSessionId(requestId: string, occurrence: number): string {
  if (!Number.isSafeInteger(occurrence) || occurrence < 0 || occurrence > 0xffffffffffff) throw new Error("Occurrence is outside UUIDv7 time range");
  const bytes = createHash("sha256").update(requestId).digest().subarray(0, 16);
  bytes.writeUIntBE(occurrence, 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function workflowTriggerFire(options: {
  sessions: Pick<PiSessionService, "ensureTriggerSession" | "nameTriggerSession" | "noteTriggerFailure" | "runWorkflow">;
  validateAction: (action: TriggerAction) => Promise<void>;
  requireWorkspace: (cwd: string) => Promise<void>;
  /** Restart acceptance can interrupt at either externally committed effect. */
  afterStep?: (step: "session" | "workflow", request: TriggerFireRequest, context: Context) => Promise<void>;
}): FireTrigger {
  return async (request, context) => {
    context.abortSignal?.throwIfAborted();
    await options.requireWorkspace(request.action.cwd);
    const sessionId = triggerSessionId(request.requestId, request.occurrence);
    const ref = { id: sessionId, cwd: request.action.cwd };
    await options.sessions.ensureTriggerSession(ref, request.action);
    try {
      await options.afterStep?.("session", request, context);
      context.abortSignal?.throwIfAborted();
      const date = new Intl.DateTimeFormat("en-US", { timeZone: request.timezone, month: "short", day: "numeric" }).format(request.occurrence);
      await options.sessions.nameTriggerSession(ref, `${request.name} · ${date}`);
      await options.validateAction(request.action);
      const run = await options.sessions.runWorkflow(ref, request.action.workflow, request.action.inputs, request.requestId);
      await options.afterStep?.("workflow", request, context);
      context.abortSignal?.throwIfAborted();
      return { sessionId, cwd: ref.cwd, runId: run.id };
    } catch (error) {
      if (context.abortSignal?.aborted === true) throw error;
      const message = error instanceof Error ? error.message : String(error);
      await options.sessions.noteTriggerFailure(ref, request.requestId, `Trigger “${request.name}” at ${new Date(request.occurrence).toISOString()} failed: ${message}`);
      throw new TriggerFireError(message, sessionId, ref.cwd);
    }
  };
}
