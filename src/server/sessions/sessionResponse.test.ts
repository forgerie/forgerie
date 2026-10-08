import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { SessionAsks } from "./sessionAsks.js";
import { responseFromBranch, SESSION_RESPONSE_CUSTOM_TYPE } from "./sessionResponse.js";
import { SessionCatalogScanner } from "./sessionCatalogScanner.js";
import type { SessionResponse } from "../../shared/sessionResponse.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const entry = (data: unknown) => ({ type: "custom", customType: SESSION_RESPONSE_CUSTOM_TYPE, data });
const started = entry({ version: 1, kind: "started" });
const declaration = (awaiting: "nothing" | "reply") => entry({ version: 1, kind: "declared", awaiting });
const user = { type: "message", message: { role: "user", content: [{ type: "text", text: "Yes" }] } };
const questions = [{ id: "choice", question: "Choose a database", options: [] }];

describe("session response protocol", () => {
  it("leaves legacy completion reports alone and never guesses intent from prose", () => {
    expect(responseFromBranch([{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Will you answer?" }] } }]).response).toEqual({ kind: "none" });
  });
  it("requires a response when an enrolled run has no declaration", () => {
    expect(responseFromBranch([started]).response).toEqual({ kind: "needs-response", reason: "undeclared" });
  });
  it("handles Pi emitting agent_start before persisting the initiating user message", () => {
    const completed = { type: "message", message: { role: "assistant", stopReason: "stop", content: "Done" } };
    expect(responseFromBranch([started, user, completed]).response).toEqual({ kind: "needs-response", reason: "undeclared" });
    expect(responseFromBranch([started, user, completed, user]).response).toEqual({ kind: "none" });
  });
  it("separates a completed result from a requested reply", () => {
    expect(responseFromBranch([started, declaration("nothing")]).response).toEqual({ kind: "none" });
    expect(responseFromBranch([started, declaration("reply")]).response).toEqual({ kind: "needs-response", reason: "reply" });
  });
  it("only clears a reply when a user message reaches the active branch", () => {
    const branch = [started, declaration("reply")];
    expect(responseFromBranch([...branch, { type: "custom_message", customType: "background-notification" }]).response.kind).toBe("needs-response");
    expect(responseFromBranch([...branch, user]).response.kind).toBe("none");
  });
  it("does not treat failed ask calls as open forms", () => {
    const attempted = { type: "message", message: { role: "toolResult", toolName: "ask_user", isError: true, details: { ask: { askId: "a", askedAt: "now", questions } } } };
    expect(responseFromBranch([started, attempted]).pendingAsk).toBeUndefined();
    expect(responseFromBranch([started, attempted]).response).toEqual({ kind: "needs-response", reason: "undeclared" });
  });
  it("does not accept a derived catalog checkpoint as conversation truth", () => {
    expect(responseFromBranch([started, entry({ version: 1, kind: "checkpoint", response: { kind: "none" } })]).response.kind).toBe("needs-response");
  });
  it("rebuilds forms after restart, follows branches, and detects stale answers from another branch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-response-")); roots.push(dir);
    const manager = SessionManager.create("/workspace", dir);
    // Real Pi persistence starts after the first assistant message.
    manager.appendMessage({ role: "assistant", content: [], api: "anthropic-messages", provider: "anthropic", model: "test", stopReason: "stop", timestamp: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const base = manager.getLeafId();
    const asks = new SessionAsks({ readResponse: () => responseFromBranch(manager.getBranch()), appendEvent: (_id, data) => { manager.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, data); }, createAskId: () => "ask-1" });
    const opened = asks.open({ sessionId: manager.getSessionId(), questions });
    const file = manager.getSessionFile(); if (file === undefined) throw new Error("No session file");
    const reloaded = SessionManager.open(file);
    const restored = new SessionAsks({ readResponse: () => responseFromBranch(reloaded.getBranch()), appendEvent: (_id, data) => { reloaded.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, data); } });
    expect(restored.pendingAsk(reloaded.getSessionId())).toEqual(opened.ask);
    expect(restored.submit(reloaded.getSessionId(), "ask-1", { answers: [{ id: "choice", values: [], otherText: "SQLite" }] }).status).toBe("closed");
    expect(responseFromBranch(SessionManager.open(file).getBranch()).pendingAsk).toBeUndefined();
    if (base === null) throw new Error("No branch base");
    reloaded.branch(base);
    expect(restored.pendingAsk(reloaded.getSessionId())).toBeUndefined();
    expect(restored.cancel(reloaded.getSessionId(), "ask-1")).toEqual({ status: "stale" });
  });
  it("reconstructs the idle catalog from compact checkpoints without loading runtimes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-response-catalog-")); roots.push(dir);
    const manager = SessionManager.create("/workspace", dir);
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "Start" }], timestamp: 1 });
    manager.appendMessage({ role: "assistant", content: [], api: "anthropic-messages", provider: "anthropic", model: "test", stopReason: "stop", timestamp: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const response: SessionResponse = { kind: "needs-response", reason: "reply" };
    manager.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, { version: 1, kind: "declared", awaiting: "reply" });
    manager.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, { version: 1, kind: "checkpoint", response });
    expect((await new SessionCatalogScanner().scanDirectories([dir]))[0]?.response).toEqual(response);
    manager.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, { version: 1, kind: "checkpoint", response: { kind: "none" } });
    expect((await new SessionCatalogScanner().scanDirectories([dir]))[0]?.response).toEqual({ kind: "none" });
  });
});
