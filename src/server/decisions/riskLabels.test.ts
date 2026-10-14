import { describe, expect, it, vi } from "vitest";
import { readDecisionHintsSettings } from "./decisionHintsSettings.js";
import type { DecisionAnswers, DecisionRequest } from "./decisionClient.js";
import { launchRiskLabel } from "./riskLabels.js";

const settings = { ...readDecisionHintsSettings({}), enabled: true, baseUrl: "http://gateway.invalid" };
export const riskAnswers: DecisionAnswers = { model: "answering-model", answers: {
  deletes_data: { type: "noul", noul: 0.9 }, outside_worktree: { type: "noul", noul: 0.2 }, acts_as_user: { type: "noul", noul: 0.1 },
  risk: { type: "score", score: 1.7, probabilities: { "0": 0, "1": 0.3, "2": 0.7 }, confidence: 0.7 },
} };

describe("detached risk labels", () => {
  it("caps arguments, asks all four questions and carries the answering model", async () => {
    let request: DecisionRequest | undefined;
    const publish = vi.fn(); const onError = vi.fn();
    launchRiskLabel({ client: { ask: (value) => { request = value; return Promise.resolve(riskAnswers); } }, readSettings: () => settings },
      { tool: "bash", args: { command: "x".repeat(20000) }, cwd: "/work", gate: { category: "publish", description: "Publish" } }, publish, onError);
    await vi.waitFor(() => { expect(publish).toHaveBeenCalledOnce(); });
    expect(JSON.stringify(request?.state).length).toBeLessThan(8500);
    expect(request).toMatchObject({ model: "fast", questions: {
      deletes_data: { type: "noul", instructions: "Does this delete or overwrite data?" },
      outside_worktree: { type: "noul", instructions: "Does this act outside the working directory /work?" },
      acts_as_user: { type: "noul", instructions: "Does this publish, send or change something under the user's name outside this machine?" },
      risk: { type: "score", criteria: ["low", "check", "danger"] },
    } });
    expect(publish).toHaveBeenCalledWith({ model: "answering-model", deletes_data: 0.9, outside_worktree: 0.2, acts_as_user: 0.1, risk: "danger", risk_score: 1.7 });
    expect(onError).not.toHaveBeenCalled();
  });
  it.each(["enabled", "risk_labels"] as const)("does not publish a late result after %s turns off", async (key) => {
    let resolve: ((value: DecisionAnswers) => void) | undefined;
    const live = { ...settings }; const publish = vi.fn();
    launchRiskLabel({ client: { ask: () => new Promise(done => { resolve = done; }) }, readSettings: () => live },
      { tool: "bash", args: {}, cwd: "/work" }, publish, vi.fn());
    await vi.waitFor(() => { expect(resolve).toBeDefined(); });
    live[key] = false; resolve?.(riskAnswers);
    await new Promise(done => setTimeout(done, 0)); expect(publish).not.toHaveBeenCalled();
  });
  it.each([{ ...settings, enabled: false }, { ...settings, risk_labels: false }, { ...settings, baseUrl: "" }])("makes no ask for disabled/unconfigured settings", async live => {
    const ask = vi.fn(() => Promise.resolve(riskAnswers));
    launchRiskLabel({ client: { ask }, readSettings: () => live }, { tool: "bash", args: {}, cwd: "/work" }, vi.fn(), vi.fn());
    await new Promise(done => setTimeout(done, 0)); expect(ask).not.toHaveBeenCalled();
  });
});

it.each(["bash", "host_ebay_seller_message_reply"])("scrubs only outbound %s state, including gate descriptions, before capping it", async tool => {
  const secret = "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
  const args = Object.freeze({command: `KEY='short-secret' curl -H "Authorization: Bearer ${secret}" --token=${"x".repeat(9000)} https://user:pass@host.test/data`,
    headers: Object.freeze({Authorization: "Bearer short-secret"}), password: "short-secret"});
  const gate = Object.freeze({category: "messages" as const, description: `Send --token=${secret}`});
  const input = Object.freeze({tool, args, cwd: `/work/${secret}`, gate});
  const original = JSON.stringify(input);
  const sent: DecisionRequest[] = [];
  const publish = vi.fn(); const onError = vi.fn();
  launchRiskLabel({client: {ask: request => {sent.push(request); return Promise.resolve(riskAnswers);}}, readSettings: () => settings}, input, publish, onError);
  await vi.waitFor(() => {expect(publish).toHaveBeenCalledOnce();});
  expect(sent[0]?.state).toEqual({tool, arguments: JSON.stringify({command: 'KEY=\'[redacted]\' curl -H "Authorization: Bearer [redacted]" --token=[redacted] https://[redacted]@host.test/data',
    headers: {Authorization: "[redacted]"}, password: "[redacted]"}), cwd: "/work/[redacted]", category: "messages", description: "Send --token=[redacted]"});
  expect(sent[0]?.questions["outside_worktree"]).toMatchObject({instructions: "Does this act outside the working directory /work/[redacted]?"});
  expect(JSON.stringify(sent)).not.toContain(secret); expect(JSON.stringify(sent)).not.toContain("short-secret");
  expect(JSON.stringify(input)).toBe(original); expect(onError).not.toHaveBeenCalled();
});
