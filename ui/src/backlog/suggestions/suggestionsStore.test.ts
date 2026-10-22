// The suggestion client: what it reads off the wire, what each press sends, and how the store keeps the server's word.
import { describe, expect, it, vi } from "vitest";
import { fromHistory, reduceEvent } from "../../transcript";
import { createSuggestionsApi, suggestionRefOf, type Suggestion } from "./suggestionsApi";
import { createSuggestionsStore } from "./suggestionsStore";
import { memoryServer } from "./fixtures/memoryApi";
import { DUPLICATE, FAILED, FAILED_ACT, LAUNCH_ERROR_LOGGED, OPEN, STARTED } from "./fixtures/suggestions";

describe("the wire", () => {
  it("reads a suggest_backlog result's record, from history and from a live tool.end, and nothing from other calls", () => {
    const details = { suggestionId: "sg-1", destination: { provider: "markdown", path: ".forgerie/backlog/a.md" } };
    expect(suggestionRefOf({ toolName: "suggest_backlog", details })).toEqual(details);
    expect(suggestionRefOf({ toolName: "file_issue", details })).toBeUndefined();
    expect(suggestionRefOf({ toolName: "suggest_backlog", details: { suggestionId: "" } })).toBeUndefined();
    const call = { role: "assistant" as const, content: [{ type: "toolCall", id: "s", name: "suggest_backlog", arguments: { title: "Retry" } }] };
    const history = fromHistory([call, { role: "toolResult", toolCallId: "s", toolName: "suggest_backlog", content: [{ type: "text", text: "Suggested" }], details }]);
    const live = reduceEvent(fromHistory([call]), { type: "tool.end", toolCallId: "s", toolName: "suggest_backlog", text: "Suggested", isError: false, details });
    for (const transcript of [history, live]) expect(transcript.messages[0]?.parts[0]).toMatchObject({ state: { type: "done", suggestion: details } });
  });

  it("drops one unreadable record, not the list, and keeps a filed record's launch error and history warning", async () => {
    const api = createSuggestionsApi(async () => Response.json({ suggestions: [OPEN, { ...OPEN, id: "bad", state: { kind: "merged" } }, LAUNCH_ERROR_LOGGED] }));
    const list = await api.list({ sessionId: "s-chat" });
    expect(list.map((record) => record.id)).toEqual([OPEN.id, LAUNCH_ERROR_LOGGED.id]);
    expect(list[1]?.state).toMatchObject({ kind: "filed", launchError: { retryable: false }, decisionLogWarning: expect.stringContaining("archived") });
  });

  it("reads which action a failed record failed at, and reads an unknown or missing one as unknown", async () => {
    const older = { kind: "failed", message: "GitHub did not answer.", retryable: true };
    const api = createSuggestionsApi(async () => Response.json({ suggestions: [FAILED_ACT, { ...FAILED, state: older }, { ...FAILED, id: "odd", state: { ...older, action: "launch" } }] }));
    expect((await api.list({})).map((record) => record.state.kind === "failed" ? record.state.action : "none")).toEqual(["file-and-act", undefined, undefined]);
  });

  it("sends each press to its route with a request id, and reads a refusal's words", async () => {
    const calls: { path: string; body: unknown }[] = [];
    const api = createSuggestionsApi(async (path, init) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return path.endsWith("/dismiss") ? Response.json({ kind: "conflict", error: "The suggestion is already filed." }, { status: 409 })
        : path.includes("?") ? Response.json({ suggestions: [] }) : Response.json(STARTED);
    }, () => "req-1");
    await api.list({ sessionId: "s chat", state: "open" });
    await api.fileAndAct("sg/1", { title: "T", modelSpec: "anthropic/claude-haiku-4-5", thinkingLevel: undefined });
    await expect(api.dismiss("sg-1")).rejects.toMatchObject({ message: "The suggestion is already filed.", status: 409, kind: "conflict" });
    expect(calls).toEqual([
      { path: "/api/backlog/suggestions?sessionId=s+chat&state=open", body: undefined },
      { path: "/api/backlog/suggestions/sg%2F1/file-and-act", body: { requestId: "req-1", title: "T", modelSpec: "anthropic/claude-haiku-4-5" } },
      { path: "/api/backlog/suggestions/sg-1/dismiss", body: {} },
    ]);
  });
});

describe("the store", () => {
  it("files the matches shown, the chosen model, and edited words only", async () => {
    const server = memoryServer([OPEN, DUPLICATE]);
    const store = createSuggestionsStore(server.api, () => ({ sessionId: "s-chat" }));
    await store.refresh();
    store.setDraft(OPEN.id, { title: OPEN.title, body: OPEN.body });
    store.setModel(OPEN.id, { modelSpec: "google/gemini-3-8-flash", thinkingLevel: "low" });
    await store.fileAndAct(OPEN.id);
    await store.file(DUPLICATE.id);
    expect(server.presses).toEqual([
      { id: OPEN.id, kind: "file-and-act", request: { modelSpec: "google/gemini-3-8-flash", thinkingLevel: "low" } },
      { id: DUPLICATE.id, kind: "file", request: { notDuplicateOf: [198, 143] } },
    ]);
    // A filed record has nothing left to edit or choose.
    expect(store.getSnapshot().drafts).toEqual({});
    expect(store.getSnapshot().models).toEqual({});
    expect(store.getSnapshot().last).toEqual({ [OPEN.id]: "file-and-act", [DUPLICATE.id]: "file" });
  });

  it("reads again after a 409, and keeps the newer revision when a stale read races a press", async () => {
    const server = memoryServer([OPEN]);
    const list = vi.fn(server.api.list);
    const store = createSuggestionsStore({ ...server.api, list }, () => ({ sessionId: "s-chat" }));
    await store.refresh();
    server.refuse(OPEN.id, { status: 409, message: "Already filed." });
    await store.file(OPEN.id);
    expect(store.getSnapshot().problems).toEqual({ [OPEN.id]: "Already filed." });
    expect(list).toHaveBeenCalledTimes(2);
    const stale: Suggestion[] = [{ ...OPEN }];
    await store.file(OPEN.id);
    list.mockResolvedValueOnce(stale);
    await store.refresh();
    expect(store.getSnapshot().suggestions?.[0]?.state.kind).toBe("filed");
  });

  it("asks once for a record a card names that the last read lacked", async () => {
    const server = memoryServer([OPEN]);
    const list = vi.fn(server.api.list);
    const store = createSuggestionsStore({ ...server.api, list }, () => ({ sessionId: "s-chat" }));
    store.want("sg-new");
    expect(list).not.toHaveBeenCalled();
    await store.refresh();
    store.want("sg-new");
    store.want("sg-new");
    store.want(OPEN.id);
    expect(list).toHaveBeenCalledTimes(2);
    expect(store.asked("sg-new")).toBe(true);
  });
});
