import { describe, expectTypeOf, it } from "vitest";
import type { SessionStatus } from "../../shared/apiTypes.js";
import type { SessionOpenReceipt, SessionOpenTransientEvent } from "../../shared/sessionOpen.js";
import type { SessionOpenHistoryPage, SessionOpenMessage, SessionOpenReader, SessionOpenResult } from "./sessionOpen.js";

describe("server open type boundary", () => {
  it("binds the shared schema to projected browser messages and server status", () => {
    expectTypeOf<SessionOpenResult["status"]>().toEqualTypeOf<SessionStatus>();
    expectTypeOf<SessionOpenResult["page"]["messages"]>().toEqualTypeOf<SessionOpenMessage[]>();
    expectTypeOf<SessionOpenResult["receipt"]>().toEqualTypeOf<SessionOpenReceipt | null>();
    expectTypeOf<SessionOpenResult["snapshot"]["transientEvents"]>().toEqualTypeOf<SessionOpenTransientEvent[]>();
    expectTypeOf<SessionOpenHistoryPage["messages"]>().toEqualTypeOf<SessionOpenMessage[]>();
    expectTypeOf<ReturnType<SessionOpenReader["open"]>>().toEqualTypeOf<Promise<SessionOpenResult>>();
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, InboxDoc, LiveDoc, UsageDoc, UserEntry, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, vi } from "vitest";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { PiSessionService } from "./piSessionService.js";
import { emptyArchiveStore, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, testModelRuntime } from "./piSessionService.testSupport.js";
import { DurableParentReadModel } from "./durableParentReadModel.js";
import { ParentAsks, ParentResponse, initializeParentDocuments } from "./durableParentDocuments.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import { PresentationHistoryIdentity } from "./sessionOpen.js";
import { pageMessagesAtSafeBoundary } from "./messagePaging.js";

function classic() {
  const hub = new SessionEventHub();
  const branch = [{ type: "message", id: "u", message: { role: "user", content: "prompt" } }];
  const runtime = fakeRuntime("classic", { sessionManager: fakeSessionManager("/workspace", { getSessionId: () => "classic", getBranch: () => branch }) });
  const service = new PiSessionService(hub, { agentDir: "/tmp/fast-chat-open-test", modelRuntime: testModelRuntime,
    archiveStore: emptyArchiveStore(), createAgentRuntime: runtimeCreator(runtime.runtime), sessionManager: sessionGateway([]), heartbeatIntervalMs: 60_000 });
  return { hub, branch, runtime, service };
}

describe("consistent open acquisition", () => {
  it("reads the active branch, status and partial in a detached cut with a daemon-stable epoch", async () => {
    const { service, hub, runtime, branch } = classic();
    try {
      await service.start("/workspace");
      runtime.session.isStreaming = true;
      Object.defineProperty(runtime.session, "state", { value: { streamingMessage: { role: "assistant", content: [{ type: "text", text: "partial" }, { type: "thinking", thinking: "plan", thinkingSignature: "secret" }] } } });
      hub.publish("classic", { type: "assistant.delta", text: "partial" });
      const result = await service.open({ id: "classic", cwd: "/workspace" }, { limit: 50 });
      expect(result).toMatchObject({ readPath: "classic", epoch: hub.epoch, seq: hub.currentSeq("classic"), page: { start: 0, total: 1, messages: [{ id: "u", content: "prompt" }] },
        snapshot: { partial: { role: "assistant", content: [{ type: "text", text: "partial" }, { type: "thinking", thinking: "plan" }] } }, status: { isStreaming: true } });
      expect(JSON.stringify(result)).not.toContain("secret");
      const user = branch[0];
      if (user === undefined) throw new Error("Missing seeded user");
      user.message.content = "mutated";
      expect(result.page.messages[0]?.content).toBe("prompt");
      expect(new SessionEventHub().epoch).not.toBe(hub.epoch);
    } finally { await service.dispose(); }
  });

  it("seeds shell output emitted before subscription and replaces a persisted shell exactly once", () => {
    const hub = new SessionEventHub();
    hub.publish("shell", { type: "shell.start", command: "printf hi", excludeFromContext: true });
    hub.publish("shell", { type: "shell.chunk", chunk: "hi" });
    expect(hub.transientEvents("shell")).toEqual([{ type: "shell.start", command: "printf hi", excludeFromContext: true }, { type: "shell.chunk", chunk: "hi" }]);
    hub.publish("shell", { type: "shell.end", output: "hi", exitCode: 0, fullOutputPath: "/tmp/disclosure" });
    hub.savedHostOutput("shell", [{ role: "bashExecution", command: "printf hi", output: "hi", exitCode: 0 }]);
    expect(hub.transientEvents("shell")).toEqual([]);
  });

  it("keeps append identity but replaces it when a prior presentation changes", () => {
    const identities = new PresentationHistoryIdentity();
    const first = identities.identify("s", [{ role: "user", id: "u", content: "one" }]);
    expect(identities.identify("s", [{ role: "user", id: "u", content: "one" }, { role: "assistant", content: "answer" }])).toBe(first);
    expect(identities.identify("s", [{ role: "user", id: "other", content: "different branch" }])).not.toBe(first);
  });

  it("returns 54 messages for the fixture's page50 and rejects a dangling older cursor", () => {
    const messages = Array.from({ length: 20 }, (_, turn) => Array.from({ length: 9 }, (_, index) => ({ role: index === 0 ? "user" : "assistant", content: `${String(turn)}/${String(index)}` }))).flat();
    const tail = pageMessagesAtSafeBoundary(messages, { limit: 50, completeTurns: true });
    expect(tail).toMatchObject({ start: 126, total: 180 });
    expect(tail.messages).toHaveLength(54);
    const earlier = pageMessagesAtSafeBoundary(messages, { before: tail.start, limit: 50, completeTurns: true });
    expect(earlier.start + earlier.messages.length).toBe(tail.start);
    expect(() => pageMessagesAtSafeBoundary(messages, { before: 127, limit: 50, completeTurns: true })).toThrow("boundary");
    expect(pageMessagesAtSafeBoundary(messages, { around: 2, limit: 1, completeTurns: true })).toMatchObject({ start: 0, messages: messages.slice(0, 9) });
  });

  it("reads native entries and asks on one read-only commit without resuming the scheduler", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fast-open-native-"));
    const harness = await Harness.open(await openNodeSqliteStorage(join(directory, "state.sqlite")), { models: createModels(), registry: createRegistry() }, context);
    try {
      const conversation = await harness.root(context);
      await conversation.commit(async tx => {
        await initializeParentDocuments(tx, { id: conversation.id });
        await tx.doc(LiveDoc, conversation.id); await tx.doc(InboxDoc, conversation.id); await tx.doc(UsageDoc, conversation.id);
        await tx.appendEntry(UserEntry, conversation.id, { model: [{ role: "user", content: "before reset", timestamp: 1 }] });
        await tx.appendEntry(conversation.id, { kind: "pi.reset", head: "self" });
        await tx.appendEntry(UserEntry, conversation.id, { model: [{ role: "user", content: "after reset", timestamp: 2 }] });
        (await tx.doc(ParentAsks, conversation.id)).pending = { askId: "ask", askedAt: new Date(0).toISOString(), questions: [{ id: "q", question: "Proceed?", options: [] }] };
        (await tx.doc(ParentResponse, conversation.id)).intent = "questions";
      }, context);
      const handle: DurableSessionHandle = { harness, conversation, address: { journalId: "j", databasePath: join(directory, "state.sqlite"), sessionId: "native", conversationId: conversation.id }, release: () => Promise.resolve() };
      const reader = new DurableParentReadModel({ handle, messageId: entry => String(entry.id) });
      const commits = vi.fn();
      const stop = harness.subscribeCommits(commits);
      const result = await reader.open("/workspace", { limit: 50 }, new SessionEventHub(), context);
      stop();
      expect(result.page.messages.map(message => message.content)).toEqual(["before reset", "after reset"]);
      expect(result.status.pendingAsk?.askId).toBe("ask");
      expect(result.status.response).toEqual({ kind: "needs-response", reason: "questions" });
      expect(commits).not.toHaveBeenCalled();
      expect((await harness.inspect(context)).scheduling).toBe("paused");
    } finally { await harness.close(context); await rm(directory, { recursive: true, force: true }); }
  });

  it("fails a native open with missing documents without creating repairs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fast-open-missing-"));
    const harness = await Harness.open(await openNodeSqliteStorage(join(directory, "state.sqlite")), { models: createModels(), registry: createRegistry() }, context);
    try {
      const conversation = await harness.root(context);
      const handle: DurableSessionHandle = { harness, conversation, address: { journalId: "j", databasePath: join(directory, "state.sqlite"), sessionId: "native", conversationId: conversation.id }, release: () => Promise.resolve() };
      const reader = new DurableParentReadModel({ handle, messageId: entry => String(entry.id) });
      await expect(reader.open("/workspace", { limit: 50 }, new SessionEventHub(), context)).rejects.toThrow("initialized");
      expect(await harness.snapshot(ParentAsks, conversation.id, context)).toBeUndefined();
    } finally { await harness.close(context); await rm(directory, { recursive: true, force: true }); }
  });
});

it("retains several unsaved shells and does not mistake an old identical record for a new save", () => {
  const hub = new SessionEventHub();
  const saved = [{ id: "old", role: "bashExecution", command: "date", output: "same", exitCode: 0 }];
  for (let index = 0; index < 2; index++) {
    hub.prepareHostShell("s", "old");
    hub.publish("s", { type: "shell.start", command: "date" });
    hub.publish("s", { type: "shell.end", output: "same", exitCode: 0 });
  }
  hub.savedHostOutput("s", saved);
  expect(hub.transientEvents("s").filter(event => event.type === "shell.start")).toHaveLength(2);
  hub.savedHostOutput("s", [...saved, { ...saved[0], id: "new", role: "bashExecution", command: "date", output: "same", exitCode: 0 }]);
  expect(hub.transientEvents("s").filter(event => event.type === "shell.start")).toHaveLength(1);
  hub.savedHostOutput("s", [...saved, { id: "new", role: "bashExecution", command: "date", output: "same", exitCode: 0 }]);
  expect(hub.transientEvents("s").filter(event => event.type === "shell.start")).toHaveLength(1);
});

import { rename, writeFile } from "node:fs/promises";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";

it("retries a real saved JSONL replacement without mixing readonly messages and positions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fast-open-readonly-"));
  const path = join(directory, "history.jsonl");
  const contents = (text: string) => [
    { type: "session", version: 3, id: "readonly", cwd: "/workspace", timestamp: "2026-01-01T00:00:00Z" },
    { type: "message", id: "u", parentId: null, timestamp: "2026-01-01T00:01:00Z", message: { role: "user", content: text, timestamp: 1 } },
  ].map(value => JSON.stringify(value)).join("\n") + "\n";
  await writeFile(path, contents("old history"));
  const gateway = createPiSessionManagerGateway({ agentDir: directory, env: {}, sessionDirEnvKeys: [] });
  const readonly = gateway.openReadOnly?.bind(gateway); if (readonly === undefined) throw new Error("Readonly gateway is required");
  let replaced = false;
  const runtime = vi.fn(() => Promise.reject(new Error("Saved opens must not start a runtime")));
  const service = new PiSessionService(new SessionEventHub(), { agentDir: directory, modelRuntime: testModelRuntime, createAgentRuntime: runtime,
    archiveStore: { ...emptyArchiveStore(), get: () => Promise.resolve({ sessionId: "readonly", cwd: "/workspace", archivePath: path, archivedAt: "2026-01-01" }) },
    sessionManager: { ...gateway, openReadOnly: async file => {
      const manager = await readonly(file);
      if (!replaced) { replaced = true; await writeFile(path + ".replacement", contents("new history")); await rename(path + ".replacement", path); }
      return manager;
    } }, heartbeatIntervalMs: 60_000 });
  try {
    const result = await service.open({ id: "readonly", cwd: "/workspace" }, { limit: 50 });
    expect(result.page).toMatchObject({ start: 0, total: 1, messages: [{ content: "new history" }] });
    expect(result.status.readOnly).toBe(true); expect(result.snapshot.partial).toBeNull(); expect(runtime).not.toHaveBeenCalled();
  } finally { await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});
