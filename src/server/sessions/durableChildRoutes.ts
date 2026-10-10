import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { normalizeRequestCwd } from "../workingDirectory.js";
import type { SessionRouteRef } from "./sessionService.js";

const MAX_TEXT_LENGTH = 64 * 1024;
const worktreeBody = Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false });
const continueBody = Type.Object({ cwd: Type.String({ minLength: 1 }), text: Type.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
  requestId: Type.String({ minLength: 1, maxLength: 128, pattern: "^[a-zA-Z0-9-]+$" }) }, { additionalProperties: false });
const discardBody = Type.Object({ cwd: Type.String({ minLength: 1 }), confirmationToken: Type.String({ minLength: 1, maxLength: 1024 }) }, { additionalProperties: false });

export interface DurableChildRouteService {
  durableChildren(ref: SessionRouteRef): Promise<unknown>;
  durableChildMessages(ref: SessionRouteRef, conversationId: number): Promise<unknown>;
  reviewDurableChildWorktree(ref: SessionRouteRef, conversationId: number): Promise<unknown>;
  continueDurableChild(ref: SessionRouteRef, conversationId: number, text: string, requestId: string): Promise<unknown>;
  landDurableChildWorktree(ref: SessionRouteRef, conversationId: number): Promise<unknown>;
  previewDurableChildWorktreeDiscard(ref: SessionRouteRef, conversationId: number): Promise<unknown>;
  discardDurableChildWorktree(ref: SessionRouteRef, conversationId: number, confirmationToken: string): Promise<unknown>;
  messageDurableChild(ref: SessionRouteRef, conversationId: number, text: string): Promise<void>;
  stopDurableChild(ref: SessionRouteRef, conversationId: number): Promise<void>;
  answerDurableChildQuestion(ref: SessionRouteRef, questionId: string, answer: string): Promise<void>;
}

/**
 *   GET  /sessions/:id/children?cwd=                  the session's child agents
 *   GET  /sessions/:id/children/:child/messages?cwd=  one child's transcript
 *   POST /sessions/:id/children/:child/message        { cwd, text }  steer, or a new input when idle
 *   POST /sessions/:id/children/:child/stop           { cwd }
 *   POST /sessions/:id/children/questions/answer      { cwd, questionId, answer }
 */
export function registerDurableChildRoutes(app: FastifyInstance, service: DurableChildRouteService, prefix = ""): void {
  const base = `${prefix}/sessions/:sessionId/children`;
  app.get<{ Params: { sessionId: string }; Querystring: { cwd?: string } }>(base, (request, reply) =>
    run(reply, () => service.durableChildren(queryRef(request.params.sessionId, request.query.cwd))));
  app.get<{ Params: { sessionId: string; child: string }; Querystring: { cwd?: string } }>(`${base}/:child/messages`, (request, reply) =>
    run(reply, () => service.durableChildMessages(queryRef(request.params.sessionId, request.query.cwd), childId(request.params.child))));
  app.post<{ Params: { sessionId: string; child: string }; Body: unknown }>(`${base}/:child/message`, (request, reply) =>
    run(reply, async () => {
      const body = record(request.body);
      await service.messageDurableChild(bodyRef(request.params.sessionId, body), childId(request.params.child), text(body["text"], "text"));
      return { ok: true };
    }));
  app.post<{ Params: { sessionId: string; child: string }; Body: unknown }>(`${base}/:child/stop`, (request, reply) =>
    run(reply, async () => {
      await service.stopDurableChild(bodyRef(request.params.sessionId, record(request.body)), childId(request.params.child));
      return { ok: true };
    }));
  app.get<{ Params: { sessionId: string; child: string }; Querystring: { cwd?: string } }>(`${base}/:child/worktree/changes`, (request, reply) =>
    run(reply, () => service.reviewDurableChildWorktree(queryRef(request.params.sessionId, request.query.cwd), childId(request.params.child)), 409));
  app.post<{ Params: { sessionId: string; child: string }; Body: unknown }>(`${base}/:child/continue`, (request, reply) =>
    run(reply, () => {
      if (!Check(continueBody, request.body)) throw new BadRequest("Invalid continuation body");
      return service.continueDurableChild(bodyRef(request.params.sessionId, request.body), childId(request.params.child), text(request.body.text, "text"), request.body.requestId);
    }, 409));
  for (const action of ["land", "discard-preview", "discard"] as const) {
    app.post<{ Params: { sessionId: string; child: string }; Body: unknown }>(`${base}/:child/worktree/${action}`, (request, reply) =>
      run(reply, () => {
        const schema = action === "discard" ? discardBody : worktreeBody;
        if (!Check(schema, request.body)) throw new BadRequest("Invalid child worktree action body");
        const body = record(request.body);
        const ref = bodyRef(request.params.sessionId, body);
        const id = childId(request.params.child);
        if (action === "land") return service.landDurableChildWorktree(ref, id);
        if (action === "discard-preview") return service.previewDurableChildWorktreeDiscard(ref, id);
        return service.discardDurableChildWorktree(ref, id, text(body["confirmationToken"], "confirmationToken"));
      }, 409));
  }
  app.post<{ Params: { sessionId: string }; Body: unknown }>(`${base}/questions/answer`, (request, reply) =>
    run(reply, async () => {
      const body = record(request.body);
      await service.answerDurableChildQuestion(bodyRef(request.params.sessionId, body), text(body["questionId"], "questionId"), text(body["answer"], "answer"));
      return { ok: true };
    }));
}

class BadRequest extends Error {}

async function run(reply: FastifyReply, action: () => Promise<unknown>, errorStatus = 500): Promise<unknown> {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof BadRequest ? 400
      : /session not found|not a child|does not host/i.test(message) ? 404
        : message.includes("is not open") || message.includes("no longer writable") ? 409 : errorStatus;
    return reply.code(status).send({ error: message });
  }
}

function queryRef(sessionId: string, cwd: string | undefined): SessionRouteRef {
  if (cwd === undefined || cwd === "") throw new BadRequest("cwd query parameter is required");
  return { id: sessionId, cwd: normalizeRequestCwd(cwd) };
}

function bodyRef(sessionId: string, body: Record<string, unknown>): SessionRouteRef {
  return queryRef(sessionId, typeof body["cwd"] === "string" ? body["cwd"] : undefined);
}

function childId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new BadRequest("child must be a conversation id");
  return id;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BadRequest("request body is required");
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new BadRequest(`${field} is required`);
  if (value.length > MAX_TEXT_LENGTH) throw new BadRequest(`${field} is too long`);
  return value;
}
