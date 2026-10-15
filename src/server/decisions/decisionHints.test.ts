import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createDecisionHints } from "./decisionHints.js";
import { scrubNonAgentVisibleEnvKeys } from "../sessiond/agentProcessEnvironment.js";
import { managedProcessEnvironment } from "../processes/managedProcessEnvironment.js";
import { getPiWebRuntime } from "../piWebStatus.js";

describe("decision hint credentials and runtime wiring", () => {
  it("captures the server key, hides it from bash and managed processes, and exposes only presence", async () => {
    const root = await mkdtemp(join(tmpdir(), "decision-key-"));
    try {
      const path = join(root, "config.json");
      await writeFile(path, JSON.stringify({ plugins: { "decision-hints": { enabled: true, settings: { gateway_url: "https://gateway.example" } } } }));
      const env = { PI_WEB_CONFIG: path, DECISION_GATEWAY_API_KEY: "private-test-key", PATH: "/usr/bin" };
      const captured = { ...env }; let authorization: string | null = null;
      const hints = createDecisionHints({ env: captured, agentDir: root, fetch: (_url, init) => {
        authorization = new Headers(init?.headers).get("authorization");
        return Promise.resolve(Response.json({ model: "answering-model", answers: { attention: { type: "noul", noul: 0.6 } } }));
      } });
      expect(managedProcessEnvironment(captured)).not.toHaveProperty("DECISION_GATEWAY_API_KEY");
      expect(JSON.stringify(managedProcessEnvironment(captured))).not.toContain("private-test-key");
      expect(scrubNonAgentVisibleEnvKeys(env)).toContain("DECISION_GATEWAY_API_KEY");
      expect(env).toEqual({ PATH: "/usr/bin" });
      expect(await hints.client.ask({ model: hints.readSettings().model, state: "reply", questions: { attention: { type: "noul", instructions: "Needs attention?" } } })).toMatchObject({ model: "answering-model" });
      expect(authorization).toBe("Bearer private-test-key");
      const runtime = await getPiWebRuntime({ request: () => Promise.resolve({ statusCode: 200, body: JSON.stringify({
        component: "sessiond", label: "Session daemon", available: true, capabilities: [], decisionHints: { ...hints.status(), apiKey: "must-be-dropped" },
      }) }) });
      expect(runtime.components.sessiond.decisionHints).toEqual({ keyPresent: true, source: "environment" });
      expect(JSON.stringify(runtime)).not.toMatch(/private-test-key|must-be-dropped|apiKey/);
      await writeFile(path, JSON.stringify({ plugins: { "decision-hints": { enabled: false } } }));
      expect(await hints.client.ask({ model: "fast", state: "reply", questions: { attention: { type: "noul", instructions: "Needs attention?" } } })).toBeUndefined();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each([undefined, "", "  "])("reports no key for %j", (value) => {
    expect(createDecisionHints({ agentDir: join(tmpdir(), randomUUID()), env: value === undefined ? {} : { DECISION_GATEWAY_API_KEY: value } }).status()).toEqual({ keyPresent: false, source: "none" });
  });
});
