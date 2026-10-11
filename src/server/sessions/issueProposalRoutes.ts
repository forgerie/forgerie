import type { FastifyInstance } from "fastify";
import { Check } from "typebox/value";
import { IssueProposalRouteBodySchema } from "../../shared/issueProposals.js";
import { normalizeRequestCwd } from "../workingDirectory.js";
import type { SessionRouteRef } from "./sessionService.js";
import { IssueProposalError, type IssueProposalDecisionResult } from "./issueProposals.js";

export interface IssueProposalRouteService {
  decideIssueProposal(ref: SessionRouteRef, proposalId: string, decision: "create" | "dismiss"): Promise<IssueProposalDecisionResult>;
}

export function registerIssueProposalRoutes(app: FastifyInstance, service: IssueProposalRouteService, prefix = ""): void {
  for (const decision of ["create", "dismiss"] as const) {
    app.post<{ Params: { sessionId: string; proposalId: string }; Body: unknown }>(`${prefix}/sessions/:sessionId/issue-proposals/:proposalId/${decision}`, async (request, reply) => {
      if (!Check(IssueProposalRouteBodySchema, request.body)) return reply.code(400).send({ error: "Only a nonempty cwd is accepted" });
      let cwd: string;
      try { cwd = normalizeRequestCwd(request.body.cwd); }
      catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
      try {
        const result = await service.decideIssueProposal({ id: request.params.sessionId, cwd }, request.params.proposalId, decision);
        if (result.status === "not-found") return await reply.code(404).send({ error: "Issue proposal is not on this session's current branch" });
        if (result.status === "already-decided") return await reply.code(409).send({ error: "Issue proposal was already decided", outcome: result.outcome });
        return result.outcome;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = error instanceof IssueProposalError ? error.status : /session not found/i.test(message) ? 404
          : /read.only|preparing|navigation/i.test(message) ? 409 : 500;
        return reply.code(status).send({ error: message });
      }
    });
  }
}
