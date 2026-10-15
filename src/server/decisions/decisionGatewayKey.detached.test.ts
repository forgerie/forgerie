import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { DecisionGatewayKeyStore } from "./decisionGatewayKey.js";
import { createDecisionClient } from "./decisionClient.js";
import { AttentionHints, type AttentionSession } from "./attentionHints.js";
import { launchRiskLabel } from "./riskLabels.js";
import { readDecisionHintsSettings } from "./decisionHintsSettings.js";

it("returns from turn settlement, bash and gate launch before a 250 ms credential stat completes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "decision-key-detached-"));
  let stats = 0; let requests = 0;
  const store = new DecisionGatewayKeyStore({ agentDir: dir, env: {}, stat: async path => {
    stats++;
    await new Promise(resolve => setTimeout(resolve, 250));
    return stat(path, { bigint: true });
  } });
  await store.set("private-detached-test-key");
  const settings = { ...readDecisionHintsSettings({}), enabled: true, baseUrl: "http://gateway.invalid" };
  const client = createDecisionClient({ readConfig: () => settings, readApiKey: () => store.readApiKey(), fetch: () => { requests++; return Promise.resolve(Response.json({})); } });
  const hints = { client, readSettings: () => settings, status: () => store.status() };
  const attention = new AttentionHints(hints, error => { throw error; }, () => new Date("2026-10-15T12:00:00Z"));
  const session: AttentionSession = {
    branch: () => [{ id: "turn", type: "message", message: { role: "assistant" } }],
    messages: () => [{ role: "assistant", content: [{ type: "text", text: "Please review." }] }],
    awaiting: () => "nothing", persist: () => Promise.resolve("stored"), publish: () => undefined,
  };
  try {
    const started = performance.now();
    attention.settled(session);
    launchRiskLabel(hints, { tool: "bash", args: { command: "true" }, cwd: dir }, () => undefined, error => { throw error; });
    launchRiskLabel(hints, { tool: "bash", args: {}, cwd: dir, gate: { category: "publish", description: "Publish" } }, () => undefined, error => { throw error; });
    expect(stats).toBe(0); expect(requests).toBe(0);
    expect(performance.now() - started).toBeLessThan(200);
    await vi.waitFor(() => { expect(stats).toBe(3); });
    expect(requests).toBe(0);
    await vi.waitFor(() => { expect(requests).toBe(3); });
  } finally { attention.dispose(); await rm(dir, { recursive: true, force: true }); }
});
