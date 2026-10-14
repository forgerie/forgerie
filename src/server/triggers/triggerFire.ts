import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import type { TriggerProjectFire } from "../../shared/triggers.js";
import type { PiSessionService } from "../sessions/piSessionService.js";
import type { FireTrigger, TriggerFireRequest, ProjectTriggerFireRequest } from "./durableTriggers.js";

export class TriggerFireError extends Error {
  constructor(message: string, readonly sessionId: string, readonly cwd: string) { super(message); }
}

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
  sessions: Pick<PiSessionService, "ensureTriggerSession" | "triggerSessionExists" | "nameTriggerSession" | "noteTriggerFailure" | "runWorkflow">;
  validateAction: (action: ProjectTriggerFireRequest["action"]) => Promise<void>;
  validateWorkspace?: (cwd: string) => Promise<void>;
  /** Restart acceptance can interrupt at either externally committed effect. */
  afterStep?: (step: "session" | "workflow", request: ProjectTriggerFireRequest, context: Context) => Promise<void>;
}): FireTrigger {
  return async (request, context) => {
    context.abortSignal?.throwIfAborted();
    const sessionId = triggerSessionId(request.legacySessionIdentity === true ? request.requestId : projectSessionKey(request.requestId, request.action.cwd), request.occurrence);
    const ref = { id: sessionId, cwd: request.action.cwd };
    try {
      await options.validateWorkspace?.(ref.cwd);
      context.abortSignal?.throwIfAborted();
      await options.sessions.ensureTriggerSession(ref, request.action);
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
      if (!await options.sessions.triggerSessionExists(ref)) throw error;
      try { await options.sessions.noteTriggerFailure(ref, request.requestId, `Trigger “${request.name}” at ${new Date(request.occurrence).toISOString()} failed: ${message}`); }
      catch (delivery) { throw new TriggerFireError(`${message}; could not persist failure message: ${delivery instanceof Error ? delivery.message : String(delivery)}`, sessionId, ref.cwd); }
      throw new TriggerFireError(message, sessionId, ref.cwd);
    }
  };
}

/** Path participates in session identity: two projects must never share a session event-stream key. */
export function projectSessionKey(requestId: string, cwd: string): string {
  return JSON.stringify([requestId, cwd]);
}

/** Every project starts immediately. One project's failure never cancels its siblings. */
export async function fireTriggerProjects(request: TriggerFireRequest, cwds: readonly string[], fire: FireTrigger, context: Context, previous: readonly TriggerProjectFire[] = [], onProject?: (project: TriggerProjectFire) => Promise<TriggerProjectFire>): Promise<TriggerProjectFire[]> {
  return Promise.all(cwds.map(async (cwd): Promise<TriggerProjectFire> => {
    const recorded = previous.find((project) => project.cwd === cwd);
    if (recorded !== undefined && recorded.outcome.kind !== "running") return recorded;
    const { targets, ...action } = request.action;
    void targets;
    let project: TriggerProjectFire;
    try {
      const receipt = await fire({ ...request, action: { ...action, cwd }, ...(request.action.targets.kind === "all" ? { unavailableIsSkip: true } : {}) }, context);
      project = { cwd, outcome: { kind: "started", sessionId: receipt.sessionId, runId: receipt.runId } };
    } catch (error) {
      if (context.abortSignal?.aborted === true) throw error;
      project = { cwd, outcome: error instanceof TriggerUnavailableError
        ? { kind: "unavailable", reason: error.message }
        : { kind: "failed", error: error instanceof Error ? error.message : String(error), ...(error instanceof TriggerFireError ? { sessionId: error.sessionId } : {}) } };
    }
    return onProject === undefined ? project : await onProject(project);
  }));
}

/** Only preflight failures under All projects use this outcome. Execution failures always need attention. */
export class TriggerUnavailableError extends Error {}

export function summarizeProjectFires(projects: readonly TriggerProjectFire[]): import("../../shared/triggers.js").TriggerFire["outcome"] {
  const failed = projects.find((project) => project.outcome.kind === "failed");
  if (failed?.outcome.kind === "failed") return { kind: "failed", error: failed.outcome.error,
    ...(failed.outcome.sessionId === undefined ? {} : { sessionId: failed.outcome.sessionId, cwd: failed.cwd }),
  };
  const started = projects.find((project) => project.outcome.kind === "started");
  if (started?.outcome.kind === "started") return { ...started.outcome, cwd: started.cwd };
  return { kind: "unavailable", reason: "No target projects could start" };
}
