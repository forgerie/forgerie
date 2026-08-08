import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  ManagedProcessKillResult,
  ManagedProcessOutputResult,
  ManagedProcessesSnapshot,
  ManagedProcessWriteResult,
} from "../../shared/apiTypes.js";
import { normalizeRequestCwd } from "../workingDirectory.js";
import type { SessionRouteRef } from "./sessionService.js";

const MAX_PROCESS_ID_LENGTH = 64;
const MAX_PROCESS_INPUT_LENGTH = 64 * 1024;

export interface ProcessRouteService {
  processes(ref: SessionRouteRef): Promise<ManagedProcessesSnapshot>;
  processOutput(ref: SessionRouteRef, id: string, tailLines?: number): Promise<ManagedProcessOutputResult>;
  killProcess(ref: SessionRouteRef, id: string): Promise<ManagedProcessKillResult>;
  writeProcess(ref: SessionRouteRef, id: string, input: string, end?: boolean): Promise<ManagedProcessWriteResult>;
}

interface ProcessQuery {
  cwd?: string;
  tailLines?: string;
}

export function registerProcessRoutes(app: FastifyInstance, processes: ProcessRouteService, prefix = ""): void {
  app.get<{ Params: { sessionId: string }; Querystring: ProcessQuery }>(
    `${prefix}/sessions/:sessionId/processes`,
    async (request, reply) => {
      const ref = sessionRefFromQuery(request.params.sessionId, request.query, reply);
      if (ref === undefined) return reply;
      try {
        return await processes.processes(ref);
      } catch (error) {
        return reply.code(sessionErrorStatus(error)).send({ error: errorMessage(error) });
      }
    },
  );

  app.get<{ Params: { sessionId: string; processId: string }; Querystring: ProcessQuery }>(
    `${prefix}/sessions/:sessionId/processes/:processId/output`,
    async (request, reply) => {
      const ref = sessionRefFromQuery(request.params.sessionId, request.query, reply);
      if (ref === undefined) return reply;
      let id: string;
      let tailLines: number | undefined;
      try {
        id = requireProcessId(request.params.processId);
        tailLines = optionalTailLines(request.query.tailLines);
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }
      try {
        return await processes.processOutput(ref, id, tailLines);
      } catch (error) {
        return reply.code(sessionErrorStatus(error)).send({ error: errorMessage(error) });
      }
    },
  );

  app.post<{ Params: { sessionId: string; processId: string }; Body: unknown }>(
    `${prefix}/sessions/:sessionId/processes/:processId/kill`,
    async (request, reply) => {
      let ref: SessionRouteRef;
      let id: string;
      try {
        const body = requireRecord(request.body);
        ref = sessionRefFromBody(request.params.sessionId, body);
        id = requireProcessId(request.params.processId);
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }
      try {
        return await processes.killProcess(ref, id);
      } catch (error) {
        return reply.code(sessionErrorStatus(error)).send({ error: errorMessage(error) });
      }
    },
  );

  app.post<{ Params: { sessionId: string; processId: string }; Body: unknown }>(
    `${prefix}/sessions/:sessionId/processes/:processId/write`,
    async (request, reply) => {
      let ref: SessionRouteRef;
      let id: string;
      let input: string;
      let end: boolean | undefined;
      try {
        const body = requireRecord(request.body);
        ref = sessionRefFromBody(request.params.sessionId, body);
        id = requireProcessId(request.params.processId);
        input = optionalString(body["input"], "input") ?? "";
        end = optionalBoolean(body["end"], "end");
        if (input === "" && end !== true) throw new Error("input or end=true is required");
        if (input.length > MAX_PROCESS_INPUT_LENGTH) throw new Error("input field is too long");
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }
      try {
        return await processes.writeProcess(ref, id, input, end);
      } catch (error) {
        return reply.code(sessionErrorStatus(error)).send({ error: errorMessage(error) });
      }
    },
  );
}

function sessionRefFromQuery(sessionId: string, query: ProcessQuery, reply: FastifyReply): SessionRouteRef | undefined {
  try {
    if (query.cwd === undefined || query.cwd === "") throw new Error("cwd query parameter is required");
    return { id: sessionId, cwd: normalizeRequestCwd(query.cwd) };
  } catch (error) {
    void reply.code(400).send({ error: errorMessage(error) });
    return undefined;
  }
}

function sessionRefFromBody(sessionId: string, body: Record<string, unknown>): SessionRouteRef {
  const cwd = body["cwd"];
  if (typeof cwd !== "string" || cwd === "") throw new Error("cwd field is required");
  return { id: sessionId, cwd: normalizeRequestCwd(cwd) };
}

function requireProcessId(value: string): string {
  if (value === "") throw new Error("processId is required");
  if (value.length > MAX_PROCESS_ID_LENGTH) throw new Error("processId is too long");
  return value;
}

function optionalTailLines(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200) throw new Error("tailLines must be an integer from 1 to 200");
  return parsed;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("request body is required");
  return Object.fromEntries(Object.entries(value));
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} field must be a string`);
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${field} field must be a boolean`);
  return value;
}

function sessionErrorStatus(error: unknown): number {
  return errorMessage(error).toLowerCase().includes("session not found") ? 404 : 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
