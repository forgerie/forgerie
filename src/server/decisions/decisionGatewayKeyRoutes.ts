import type { FastifyInstance } from "fastify";
import { decisionGatewayKeyClearSchema, decisionGatewayKeyErrors, decisionGatewayKeySetSchema } from "../../shared/decisionHints.js";
import { DecisionGatewayKeyError, type DecisionGatewayKeyStore } from "./decisionGatewayKey.js";

/** Private sessiond routes. The web Settings middleware owns browser origin and catalog checks.
 * The daemon checks its own profile revision, so a restart cannot redirect a stale write.
 */
export function registerDecisionGatewayKeyRoutes(app: FastifyInstance, store: DecisionGatewayKeyStore, profileRevision: string): void {
  app.register((scope, _options, done) => {
    // Fastify's default JSON error may quote the invalid body. Never send or log it.
    scope.setErrorHandler((_error, _request, reply) => reply.code(400).send({ code: "invalid", error: decisionGatewayKeyErrors.invalid.error }));
    scope.get("/decision-hints/gateway-key", async (_request, reply) => {
      reply.header("cache-control", "no-store");
      return store.status();
    });
    for (const clear of [false, true]) scope.post(`/decision-hints/gateway-key${clear ? "/clear" : ""}`, { bodyLimit: 32_768 }, async (request, reply) => {
      reply.header("cache-control", "no-store");
      const parsed = (clear ? decisionGatewayKeyClearSchema : decisionGatewayKeySetSchema).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "invalid", error: decisionGatewayKeyErrors.invalid.error });
      if (parsed.data.revision !== profileRevision) return reply.code(409).send({ code: "conflict", error: decisionGatewayKeyErrors.conflict.error });
      try {
        if ("apiKey" in parsed.data && typeof parsed.data.apiKey === "string") await store.set(parsed.data.apiKey);
        else await store.clear();
        return await store.status();
      } catch (error) {
        const code = error instanceof DecisionGatewayKeyError && error.status === 409 ? "environment" : "storage";
        const failure = decisionGatewayKeyErrors[code];
        return reply.code(failure.status).send({ code, error: failure.error });
      }
    });
    done();
  });
}
