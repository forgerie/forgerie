import type { FastifyInstance } from "fastify";
import type { PromptLibrary, PromptSaveResult } from "./promptLibrary.js";

/**
 * Session-free authoring endpoint for the agent profile's prompt library, so a
 * prompt can be written from any surface (the prompt dialog, a script) without
 * an open session. Refusals carry the library's own explanation; the status
 * code only classifies it.
 */
export function registerPromptLibraryRoutes(app: FastifyInstance, library: PromptLibrary, prefix = ""): void {
  app.post<{ Body: { name?: unknown; body?: unknown } }>(`${prefix}/prompts`, async (request, reply) => {
    const name = request.body.name;
    const body = request.body.body;
    if (typeof name !== "string" || typeof body !== "string") {
      return await reply.code(400).send({ error: "Prompt name and body are required strings" });
    }
    const result = await library.save({ name, body });
    if (result.kind === "saved") return { name: result.name, path: result.path };
    return await reply.code(promptSaveStatus(result)).send({ error: result.message });
  });
}

function promptSaveStatus(result: Exclude<PromptSaveResult, { kind: "saved" }>): number {
  if (result.kind === "name-taken") return 409;
  if (result.kind === "write-failed") return 500;
  return 400;
}
