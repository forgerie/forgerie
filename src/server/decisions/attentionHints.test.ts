import { describe, expect, it, vi } from "vitest";
import { AttentionHints, ATTENTION_HINT_CUSTOM_TYPE, type AttentionSession } from "./attentionHints.js";
import type { DecisionAnswers, DecisionRequest } from "./decisionClient.js";
import { readDecisionHintsSettings } from "./decisionHintsSettings.js";
import type { DecisionHints } from "./decisionHints.js";

const now = () => new Date("2026-10-14T12:00:00Z");
function answers(probability = 0.8, confidence = 0.9): DecisionAnswers {
  return { model: "answering-model", answers: {
    kind: { type: "choice", choice: "review", confidence, probabilities: {} },
    asks_user: { type: "noul", noul: probability }, stopped_early: { type: "noul", noul: 0.1 },
    urgency: { type: "score", score: 2, confidence, probabilities: {} },
  } };
}
function fixture() {
  const settings = { ...readDecisionHintsSettings({}), enabled: true, baseUrl: "http://gateway.invalid" };
  let resolve!: (result: DecisionAnswers | undefined) => void;
  const requests: DecisionRequest[] = [];
  const deps: DecisionHints = { readSettings: () => settings, status: () => ({ keyPresent: false }), client: { ask(request) {
    requests.push(request); return new Promise((done) => { resolve = done; });
  } } };
  const branch: unknown[] = [{ id: "reply-1", type: "message", message: { role: "assistant" } }];
  const published = vi.fn();
  const session: AttentionSession = { branch: () => branch, messages: () => [{ role: "assistant", content: [{ type: "thinking", text: "private thinking" }, { type: "text", text: "Please review. " + "x".repeat(9000) }] }], awaiting: () => "nothing",
    persist: (data) => { branch.push({ type: "custom", customType: ATTENTION_HINT_CUSTOM_TYPE, data }); return Promise.resolve(); }, publish: published };
  const errors = vi.fn();
  const hints = new AttentionHints(deps, errors, now);
  return { hints, session, branch, settings, deps, requests, published, errors, resolve: (result: DecisionAnswers | undefined) => { resolve(result); } };
}

describe("attention hints", () => {
  it("asks once per settlement, caps only visible reply text, and keeps the declaration separate", async () => {
    const f = fixture();
    f.hints.settled(f.session); f.hints.settled(f.session);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.state).toEqual({ reply: ("Please review. " + "x".repeat(9000)).slice(0, 8192), awaiting: "nothing" });
    expect(Object.keys(f.requests[0]?.questions ?? {})).toEqual(["kind", "asks_user", "urgency", "stopped_early"]);
    expect(f.hints.read(f.session)).toBeUndefined();
    f.resolve(answers());
    await vi.waitFor(() => { expect(f.published).toHaveBeenCalledOnce(); });
    expect(f.hints.read(f.session)).toEqual({ turnId: "reply-1", model: "answering-model", at: now().toISOString(), likelyNeedsYou: true, kind: "review", urgency: "high" });
    expect(new AttentionHints(f.deps, f.errors, now).read(f.session)).toEqual(f.hints.read(f.session));
  });
  it.each(["enabled", "attention"] as const)("discards late replies when %s turns off", async (setting) => {
    const f = fixture(); f.hints.settled(f.session); f.settings[setting] = false; f.resolve(answers());
    await Promise.resolve(); await Promise.resolve();
    expect(f.published).not.toHaveBeenCalled(); expect(f.branch).toHaveLength(1);
  });
  it("invalidates a pending ask immediately when input arrives, even before delivery", async () => {
    const f = fixture(); f.hints.settled(f.session); f.hints.invalidate(f.session); f.resolve(answers());
    await Promise.resolve(); await Promise.resolve();
    expect(f.published).not.toHaveBeenCalled();
    expect(new AttentionHints(f.deps, f.errors, now).read(f.session)).toBeUndefined();
  });
  it("invalidates completed hints on input and rejects a hint from a previous turn", async () => {
    const f = fixture(); f.hints.settled(f.session); f.resolve(answers());
    await vi.waitFor(() => { expect(f.published).toHaveBeenCalledOnce(); });
    f.branch.push({ id: "user-2", type: "message", message: { role: "user" } });
    expect(f.hints.read(f.session)).toBeUndefined();
    f.branch.pop(); f.hints.invalidate(f.session);
    expect(f.hints.read(f.session)).toBeUndefined();
    expect(new AttentionHints(f.deps, f.errors, now).read(f.session)).toBeUndefined();
  });
  it.each(["high", "normal", "low"] as const)("uses live %s sensitivity with inclusive thresholds", async (sensitivity) => {
    const f = fixture(); const threshold = { high: 0.6, normal: 0.75, low: 0.9 }[sensitivity];
    f.settings.sensitivity = sensitivity;
    f.hints.settled(f.session); f.resolve(answers(threshold));
    await vi.waitFor(() => { expect(f.published).toHaveBeenCalledOnce(); });
    expect(f.hints.read(f.session)?.likelyNeedsYou).toBe(true);
    if (sensitivity !== "low") { f.settings.sensitivity = "low"; expect(f.hints.read(f.session)?.likelyNeedsYou).toBe(false); }
  });
  it("promotes for stopped-early and withholds uncertain kind and urgency", async () => {
    const f = fixture(); f.hints.settled(f.session);
    const result = answers(0.1, 0.74); result.answers["stopped_early"] = { type: "noul", noul: 0.8 }; f.resolve(result);
    await vi.waitFor(() => { expect(f.published).toHaveBeenCalledOnce(); });
    expect(f.hints.read(f.session)).toMatchObject({ likelyNeedsYou: true });
    expect(f.hints.read(f.session)).not.toHaveProperty("kind"); expect(f.hints.read(f.session)).not.toHaveProperty("urgency");
  });
  it("reports persistence errors without publishing a successful hint", async () => {
    const f = fixture(); f.session.persist = () => Promise.reject(new Error("disk full"));
    f.hints.settled(f.session); f.resolve(answers());
    await vi.waitFor(() => { expect(f.errors).toHaveBeenCalledOnce(); });
    expect(f.hints.read(f.session)).toBeUndefined(); expect(f.published).not.toHaveBeenCalled();
  });
  it("does not triage a settling old run after queued input, but replaces it on the next run", async () => {
    const f = fixture(); f.hints.settled(f.session); f.resolve(answers());
    await vi.waitFor(() => { expect(f.published).toHaveBeenCalledOnce(); });
    f.hints.invalidate(f.session);
    f.hints.settled(f.session);
    expect(f.requests).toHaveLength(1);
    f.hints.started(f.session);
    f.branch.push({ id: "reply-2", type: "message", message: { role: "assistant" } });
    f.hints.settled(f.session); f.resolve(answers(0.1));
    await vi.waitFor(() => { expect(f.published).toHaveBeenCalledTimes(2); });
    expect(f.hints.read(f.session)).toMatchObject({ turnId: "reply-2", likelyNeedsYou: false });
  });
  it("sends no ask with the attention switch off", () => {
    const f = fixture(); f.settings.attention = false; f.hints.settled(f.session);
    expect(f.requests).toHaveLength(0); expect(f.hints.read(f.session)).toBeUndefined();
  });
  it("cannot publish or persist a result after its service closes", async () => {
    const f = fixture(); f.hints.settled(f.session); f.hints.dispose(); f.resolve(answers());
    await Promise.resolve(); await Promise.resolve();
    expect(f.published).not.toHaveBeenCalled(); expect(f.branch).toHaveLength(1);
  });

  it("does not send an earlier turn's reply when the current turn has no assistant text", () => {
    const f = fixture();
    f.session.messages = () => [{ role: "assistant", content: [{ type: "text", text: "An old reply" }] }, { role: "user", content: "New input" }];
    f.hints.settled(f.session);
    expect(f.requests[0]?.state).toEqual({ reply: "", awaiting: "nothing" });
  });

  it.each(["enabled", "attention", "baseUrl"] as const)("writes no tombstone when %s is disabled or unconfigured", async setting => {
    const f = fixture(); const writes = vi.spyOn(f.session, "persist");
    f.hints.settled(f.session); f.resolve(answers());
    await vi.waitFor(() => { expect(f.published).toHaveBeenCalledOnce(); });
    if (setting === "baseUrl") f.settings.baseUrl = ""; else f.settings[setting] = false;
    f.hints.invalidate(f.session); f.hints.started(f.session);
    expect(writes).toHaveBeenCalledOnce(); expect(f.hints.read(f.session)).toBeUndefined();
  });
  it("redacts credentials from attention text without changing the visible reply", () => {
    const f = fixture();
    const text = 'API_KEY=local-api-key Authorization: Bearer local-bearer\ncurl -u user:short-pass -H "X-Api-Key: local-header" -H "Cookie: sid=local-cookie" https://api.test';
    f.session.messages = () => [{ role: "assistant", content: [{ type: "text", text }] }];
    f.hints.settled(f.session);
    expect(f.requests[0]?.state).toEqual({ reply: 'API_KEY=[redacted] Authorization: Bearer [redacted]\ncurl -u [redacted] -H "X-Api-Key: [redacted]" -H "Cookie: [redacted]" https://api.test', awaiting: "nothing" });
    expect(JSON.stringify(f.session.messages())).toContain("local-api-key");
  });
  it("scrubs complete credentials before truncating a reply", () => {
    const f = fixture();
    f.session.messages = () => [{ role: "assistant", content: [{ type: "text", text: "Public note. ".repeat(620) + 'API_KEY="must-stay-local ' + "x".repeat(6000) + '"' }] }];
    f.hints.settled(f.session);
    const state = f.requests[0]?.state;
    expect(state).toEqual({ reply: "Public note. ".repeat(620) + 'API_KEY="[redacted]"', awaiting: "nothing" });
  });

});
