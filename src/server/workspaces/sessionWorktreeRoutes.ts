import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { ClientSession } from "../types.js";
import type { SessionRouteService } from "../sessions/sessionService.js";
import { isKnownThinkingLevel } from "../../shared/thinkingLevels.js";
import type { UserSessionStart, NewSessionDestination } from "../../shared/sessionWorktree.js";
import { UserSessionStartSchema } from "../../shared/sessionWorktree.js";
import { SessionWorktrees } from "./sessionWorktrees.js";
import { normalizeRequestCwd } from "../workingDirectory.js";

const discardBody = Type.Object({ confirmationToken: Type.String({ minLength: 1 }) }, { additionalProperties: false });

/** Browser creation is the only entry point that chooses fresh-worktree by default. Agent creation stays unchanged. */
export class UserSessionWorktrees {
  private readonly pending = new Map<string, Promise<ClientSession>>();
  constructor(readonly worktrees: SessionWorktrees, private readonly sessions: SessionRouteService) {}

  start(input: UserSessionStart): Promise<ClientSession> {
    const key = input.startupToken === undefined ? undefined : JSON.stringify([normalizeRequestCwd(input.cwd), input.startupToken]);
    const existing = key === undefined ? undefined : this.pending.get(key);
    if (existing !== undefined) return existing;
    const pending = this.startOnce(input);
    if (key !== undefined) {
      this.pending.set(key, pending);
      void pending.finally(() => { if (this.pending.get(key) === pending) this.pending.delete(key); }).catch(() => undefined);
    }
    return pending;
  }
  private async startOnce(input: UserSessionStart): Promise<ClientSession> {
    const cwd = normalizeRequestCwd(input.cwd);
    const requestedDestination: NewSessionDestination | undefined = input.destination;
    if (input.thinkingLevel !== undefined && !isKnownThinkingLevel(input.thinkingLevel)) throw new Error("Unknown thinkingLevel");
    const choices = {
      ...(input.startupToken === undefined ? {} : { startupToken: input.startupToken }),
      ...(input.modelSpec === undefined ? {} : { initialModelSpec: input.modelSpec }),
      ...(input.thinkingLevel === undefined || !isKnownThinkingLevel(input.thinkingLevel) ? {} : { initialThinkingLevel: input.thinkingLevel }),
    };
    if (requestedDestination?.kind === "existing-workspace") {
      if (input.setupId !== undefined) throw new Error("setupId cannot target an existing workspace");
      return this.sessions.start(cwd, choices);
    }
    const options = await this.worktrees.options(cwd);
    if (options.kind === "non-git") {
      if (requestedDestination?.kind === "fresh-worktree" || input.setupId !== undefined) throw new Error("Fresh worktrees require a Git project");
      return this.sessions.start(cwd, choices);
    }
    const prior = input.startupToken === undefined || input.setupId !== undefined ? undefined
      : (await this.worktrees.store.list()).find((record) => record.repo === options.repo && record.startupToken === input.startupToken);
    if (prior?.sessionId !== undefined && prior.ownerSession !== undefined) {
      return { ...prior.ownerSession, worktree: await this.worktrees.info(prior, prior.sessionId) };
    }
    const record = await this.worktrees.create(cwd, input.startupToken, input.setupId ?? prior?.id);
    let session: ClientSession | undefined;
    try {
      session = await this.sessions.start(record.path, choices);
      await this.worktrees.attach(record.id, session);
      return { ...session, worktree: await this.worktrees.info(await this.worktrees.store.require(record.id), session.id) };
    } catch (error) {
      if (session !== undefined) await this.sessions.stop(session);
      await this.worktrees.failedStart(record.id, error);
      throw error;
    }
  }
}

export function registerSessionWorktreeRoutes(app: FastifyInstance, userSessions: UserSessionWorktrees, prefix = ""): void {
  const worktrees = userSessions.worktrees;
  app.get<{ Querystring: { cwd?: string } }>(`${prefix}/sessions/worktree-options`, async (request, reply) => {
    try {
      if (request.query.cwd === undefined || request.query.cwd === "") throw new Error("cwd query parameter is required");
      return await worktrees.options(normalizeRequestCwd(request.query.cwd));
    } catch (error) { return reply.code(400).send({ error: errorMessage(error) }); }
  });
  // Setup logs are state, not transcript entries. This inventory supports reload during a failed first send.
  app.get<{ Querystring: { cwd?: string } }>(`${prefix}/sessions/worktrees`, async (request, reply) => {
    try {
      const cwd = request.query.cwd;
      return { worktrees: (await worktrees.store.list()).filter((record) => cwd === undefined || record.repo === normalizeRequestCwd(cwd) || record.path === normalizeRequestCwd(cwd)) };
    } catch (error) { return reply.code(400).send({ error: errorMessage(error) }); }
  });
  app.get<{ Params: { worktreeId: string } }>(`${prefix}/sessions/worktrees/:worktreeId`, async (request, reply) => {
    try {
      const record = await worktrees.store.require(request.params.worktreeId);
      return { worktree: record, info: await worktrees.info(record, record.sessionId ?? record.relatedSession?.id ?? "") };
    } catch (error) { return reply.code(404).send({ error: errorMessage(error) }); }
  });
  app.post<{ Params: { worktreeId: string } }>(`${prefix}/sessions/worktrees/:worktreeId/land`, async (request, reply) => {
    try {
      const record = await worktrees.store.require(request.params.worktreeId);
      if (record.setup.phase !== "done" && record.state.kind === "active") throw new Error("Finish session setup before landing");
      return await worktrees.land(record.id, []);
    } catch (error) { return reply.code(409).send({ error: errorMessage(error) }); }
  });
  app.post<{ Params: { worktreeId: string } }>(`${prefix}/sessions/worktrees/:worktreeId/discard-preview`, async (request, reply) => {
    try { return await worktrees.discardPreview(request.params.worktreeId); }
    catch (error) { return reply.code(409).send({ error: errorMessage(error) }); }
  });
  app.post<{ Params: { worktreeId: string }; Body: unknown }>(`${prefix}/sessions/worktrees/:worktreeId/discard`, async (request, reply) => {
    try {
      if (!Check(discardBody, request.body)) throw new Error("confirmationToken from a discard preview is required");
      const record = await worktrees.store.require(request.params.worktreeId);
      if (record.setup.phase !== "done" && record.setup.phase !== "failed") throw new Error("Wait for setup to finish before discarding");
      return await worktrees.discard(record.id, request.body.confirmationToken, []);
    } catch (error) { return reply.code(409).send({ error: errorMessage(error) }); }
  });
}

export function parseUserSessionStart(value: unknown): UserSessionStart {
  if (!Check(UserSessionStartSchema, value)) throw new Error("Invalid new session request");
  return value;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
