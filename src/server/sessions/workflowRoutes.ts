import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { WorkflowLaunchSchema, WorkflowWorkerModelSchema, type WorkflowModels, WorkflowFinishSchema, WorkflowStopDecisionSchema, type WorkflowInputs, type WorkflowOutcome, type WorkflowStopDecision } from "../../shared/workflowRuns.js";
import { WorkflowProposalStartSchema, WorkflowProposalChangesSchema, WorkflowProposalDismissSchema, type WorkflowProposal } from "../../shared/workflowProposals.js";
import type { WorkflowRun } from "../../shared/workflowRuns.js";
import type { SessionRouteRef } from "./sessionService.js";
import { normalizeRequestCwd } from "../workingDirectory.js";
import { WorkflowError } from "../resources/workflowLibrary.js";

export interface WorkflowRouteService {
  workflowInventory(ref: SessionRouteRef): Promise<unknown>;
  workflowRuns(ref: SessionRouteRef): Promise<unknown>;
  workflowProposals(ref: SessionRouteRef): Promise<WorkflowProposal[]>;
  startWorkflowProposal(ref: SessionRouteRef, id: string, inputs: WorkflowInputs, requestId: string, models?: WorkflowModels): Promise<WorkflowRun>;
  changeWorkflowProposal(ref: SessionRouteRef, id: string, note: string): Promise<WorkflowProposal>;
  dismissWorkflowProposal(ref: SessionRouteRef, id: string): Promise<WorkflowProposal>;
  runWorkflow(ref: SessionRouteRef, name: string, inputs: WorkflowInputs, requestId: string, models?: WorkflowModels): Promise<unknown>;
  setWorkflowWorkerModel(ref: SessionRouteRef, runId: string, worker: string, model: string | null): Promise<WorkflowRun>;
  finishWorkflow(ref: SessionRouteRef, runId: string, outcome: WorkflowOutcome, result: string): Promise<void>;
  decideWorkflowStop(ref: SessionRouteRef, runId: string, stage: string, decision: WorkflowStopDecision, note: string | undefined): Promise<unknown>;
}
const query = Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false });

export function registerWorkflowRoutes(app: FastifyInstance, service: WorkflowRouteService, prefix = ""): void {
  for (const suffix of ["workflows", "workflow-runs", "workflow-proposals"] as const) {
    app.get<{ Params: { sessionId: string }; Querystring: unknown }>(`${prefix}/sessions/:sessionId/${suffix}`, (request, reply) => run(reply, () => {
      if (!Check(query, request.query)) throw new WorkflowError(400, "Only a nonempty cwd query is accepted");
      const ref = { id: request.params.sessionId, cwd: normalizeRequestCwd(request.query.cwd) };
      return suffix === "workflows" ? service.workflowInventory(ref) : suffix === "workflow-runs" ? service.workflowRuns(ref) : service.workflowProposals(ref);
    }));
  }
  app.post<{ Params: { sessionId: string; proposalId: string }; Body: unknown }>(`${prefix}/sessions/:sessionId/workflow-proposals/:proposalId/start`, (request, reply) => run(reply, () => {
    if (!Check(WorkflowProposalStartSchema, request.body)) throw new WorkflowError(400, "Invalid workflow proposal start body");
    return service.startWorkflowProposal({ id: request.params.sessionId, cwd: normalizeRequestCwd(request.body.cwd) }, request.params.proposalId, request.body.inputs, request.body.requestId, request.body.models);
  }));
  app.post<{ Params: { sessionId: string; proposalId: string }; Body: unknown }>(`${prefix}/sessions/:sessionId/workflow-proposals/:proposalId/changes`, (request, reply) => run(reply, () => {
    if (!Check(WorkflowProposalChangesSchema, request.body) || request.body.note.trim() === "") throw new WorkflowError(400, "A workflow proposal changes note is required");
    return service.changeWorkflowProposal({ id: request.params.sessionId, cwd: normalizeRequestCwd(request.body.cwd) }, request.params.proposalId, request.body.note);
  }));
  app.post<{ Params: { sessionId: string; proposalId: string }; Body: unknown }>(`${prefix}/sessions/:sessionId/workflow-proposals/:proposalId/dismiss`, (request, reply) => run(reply, () => {
    if (!Check(WorkflowProposalDismissSchema, request.body)) throw new WorkflowError(400, "Invalid workflow proposal dismiss body");
    return service.dismissWorkflowProposal({ id: request.params.sessionId, cwd: normalizeRequestCwd(request.body.cwd) }, request.params.proposalId);
  }));
  app.post<{ Params: { sessionId: string }; Body: unknown }>(`${prefix}/sessions/:sessionId/workflow-runs`, (request, reply) => run(reply, () => {
    if (!Check(WorkflowLaunchSchema, request.body)) throw new WorkflowError(400, "Invalid workflow launch body");
    return service.runWorkflow({ id: request.params.sessionId, cwd: normalizeRequestCwd(request.body.cwd) }, request.body.name, request.body.inputs, request.body.requestId, request.body.models);
  }));
  app.post<{ Params: { sessionId: string; runId: string; worker: string }; Body: unknown }>(`${prefix}/sessions/:sessionId/workflow-runs/:runId/workers/:worker/model`, (request, reply) => run(reply, () => {
    if (!Check(WorkflowWorkerModelSchema, request.body)) throw new WorkflowError(400, "Invalid workflow worker model");
    return service.setWorkflowWorkerModel({ id: request.params.sessionId, cwd: normalizeRequestCwd(request.body.cwd) }, request.params.runId, request.params.worker, request.body.model);
  }));
  app.post<{ Params: { sessionId: string; runId: string }; Body: unknown }>(`${prefix}/sessions/:sessionId/workflow-runs/:runId/finish`, (request, reply) => run(reply, async () => {
    if (!Check(WorkflowFinishSchema, request.body) || request.body.result.trim() === "") throw new WorkflowError(400, "Invalid workflow finish body");
    await service.finishWorkflow({ id: request.params.sessionId, cwd: normalizeRequestCwd(request.body.cwd) }, request.params.runId, request.body.outcome, request.body.result);
    return { ok: true };
  }));
  app.post<{ Params: { sessionId: string; runId: string; stage: string }; Body: unknown }>(`${prefix}/sessions/:sessionId/workflow-runs/:runId/stops/:stage`, (request, reply) => run(reply, () => {
    if (!Check(WorkflowStopDecisionSchema, request.body)) throw new WorkflowError(400, "Invalid workflow stop decision");
    const ref = { id: request.params.sessionId, cwd: normalizeRequestCwd(request.body.cwd) };
    return service.decideWorkflowStop(ref, request.params.runId, request.params.stage, request.body.decision, request.body.note);
  }));
}
async function run(reply: FastifyReply, action: () => Promise<unknown>): Promise<unknown> {
  try { return await action(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof WorkflowError ? error.status : /session not found|does not host/i.test(message) ? 404
      : /read.only|preparing|navigation|durableChildren/i.test(message) ? 409 : 500;
    return reply.code(status).send({ error: message });
  }
}
