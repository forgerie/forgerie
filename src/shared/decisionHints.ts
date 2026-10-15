import { z } from "zod";

/** Public status is an allowlist. Never project the gateway credential or its fingerprint. */
export const decisionHintsStatusSchema = z.discriminatedUnion("source", [
  z.object({ keyPresent: z.literal(true), source: z.literal("environment") }),
  z.object({ keyPresent: z.literal(true), source: z.literal("settings") }),
  z.object({ keyPresent: z.literal(false), source: z.literal("none") }),
]);
export type DecisionHintsStatus = z.infer<typeof decisionHintsStatusSchema>;

export const decisionGatewayApiKeySchema = z.string().max(4096).regex(/^[^\p{Cc}]*$/u).trim().min(1);
export const decisionGatewayKeySetSchema = z.object({ revision: z.string().min(1), apiKey: decisionGatewayApiKeySchema }).strict();
export const decisionGatewayKeyClearSchema = z.object({ revision: z.string().min(1) }).strict();

export const decisionGatewayKeyErrorCodeSchema = z.enum(["environment", "conflict", "invalid", "storage", "unavailable"]);
export const decisionGatewayKeyErrors = {
  environment: { status: 409, error: "The key is set by DECISION_GATEWAY_API_KEY in sessiond's environment. Settings cannot replace or remove it." },
  conflict: { status: 409, error: "Settings or the active profile changed. Reload before changing the gateway key." },
  invalid: { status: 400, error: "Gateway key must be non-empty, at most 4096 characters, and contain no control characters. Send the current settings revision." },
  storage: { status: 500, error: "Cannot access the gateway key file in the active agent profile. Check decision-gateway.json and its permissions." },
  unavailable: { status: 502, error: "Sessiond did not report gateway key status. Check that sessiond is running." },
} as const;
