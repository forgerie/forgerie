// The suggestion client: what it reads off the wire, what each press sends, and how the store keeps the server's word.
import { describe, expect, it, vi } from "vitest";
import { fromHistory, reduceEvent } from "../../transcript";
import { createSuggestionsApi, suggestionRefOf, type Suggestion } from "./suggestionsApi";
import { createSuggestionsStore } from "./suggestionsStore";
import { filedItemOf } from "./suggestionsModel";
import type { BacklogItem } from "../backlogApi";
import { memoryServer } from "./fixtures/memoryApi";
import { DISMISSED_UNSAFE, DUPLICATE, FAILED, FAILED_ACT, FILED, LAUNCH_ERROR, LAUNCH_ERROR_LOGGED, MARKDOWN_DUPLICATE, OPEN, STARTED } from "./fixtures/suggestions";

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

describe("the wire, for the fields the server is adding", () => {
  it("reads the launch choice on filing and filed, and the state a dismissed record restores to", async () => {
    const filing = { ...OPEN, id: "sg-filing", state: { kind: "filing", action: "file-and-act", launchChoice: { modelSpec: "google/gemini-3-8-flash" } } };
    const nested = { ...OPEN, id: "sg-odd", state: { kind: "dismissed", at: "", restoreTo: { kind: "dismissed", at: "" } } };
    const api = createSuggestionsApi(async () => Response.json({ suggestions: [filing, LAUNCH_ERROR, DISMISSED_UNSAFE, nested] }));
    const [one, two, three, four] = await api.list({});
    expect(one?.state).toEqual({ kind: "filing", action: "file-and-act", launchChoice: { modelSpec: "google/gemini-3-8-flash" } });
    expect(two?.state).toMatchObject({ kind: "filed", launchChoice: { modelSpec: "google/gemini-3-8-flash", thinkingLevel: "low" } });
    expect(three?.state).toMatchObject({ kind: "dismissed", restoreTo: { kind: "failed", retryable: false, action: "file" } });
    // A record restores only to a state it can be in before dismissal; anything else reads as unknown.
    expect(four?.state).toEqual({ kind: "dismissed", at: "", restoreTo: undefined });
  });

  it("sends acknowledgedPaths with File anyway, and leaves out an empty list", async () => {
    const bodies: unknown[] = [];
    const api = createSuggestionsApi(async (_path, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json(FILED); }, () => "req");
    await api.file("sg-1", { acknowledgedPaths: [".forgerie/backlog/a.md"] });
    await api.fileAndAct("sg-1", { acknowledgedPaths: undefined });
    expect(bodies).toEqual([{ requestId: "req", acknowledgedPaths: [".forgerie/backlog/a.md"] }, { requestId: "req" }]);
  });
});

describe("the store", () => {
  it("files past a Markdown duplicate by the paths shown, and a GitHub one by number", async () => {
    const server = memoryServer([MARKDOWN_DUPLICATE, DUPLICATE]);
    const store = createSuggestionsStore(server.api, () => ({ sessionId: "s-chat" }));
    await store.refresh();
    await store.file(MARKDOWN_DUPLICATE.id);
    await store.fileAndAct(DUPLICATE.id);
    expect(server.presses).toEqual([
      { id: MARKDOWN_DUPLICATE.id, kind: "file", request: { acknowledgedPaths: [".forgerie/backlog/2026-10-02-retry-dropped-stream.md", ".forgerie/backlog/2026-09-12-relay-tool-rows.md"] } },
      { id: DUPLICATE.id, kind: "file-and-act", request: { notDuplicateOf: [198, 143] } },
    ]);
  });

  it("keeps the chosen model when filing succeeds but the launch fails, so the retry sends the same choice", async () => {
    const server = memoryServer([OPEN]);
    const launchFailed = { ...OPEN, revision: 2, state: { kind: "filed" as const, provider: "markdown", path: ".forgerie/backlog/a.md", at: "",
      launchChoice: { modelSpec: "google/gemini-3-8-flash", thinkingLevel: "low" }, launchError: { message: "The disk is full.", retryable: true } } };
    const fileAndAct = vi.fn().mockResolvedValueOnce(launchFailed).mockImplementation(server.api.fileAndAct);
    const store = createSuggestionsStore({ ...server.api, fileAndAct }, () => ({ sessionId: "s-chat" }));
    await store.refresh();
    store.setModel(OPEN.id, { modelSpec: "google/gemini-3-8-flash", thinkingLevel: "low" });
    await store.fileAndAct(OPEN.id);
    expect(store.getSnapshot().models[OPEN.id]).toEqual({ modelSpec: "google/gemini-3-8-flash", thinkingLevel: "low" });
    await store.fileAndAct(OPEN.id);
    expect(fileAndAct.mock.calls.map(([, request]) => request)).toEqual([
      { modelSpec: "google/gemini-3-8-flash", thinkingLevel: "low" }, { modelSpec: "google/gemini-3-8-flash", thinkingLevel: "low" }]);
    // Started: nothing left to choose.
    expect(store.getSnapshot().models).toEqual({});
  });

  it("says when a record turns filed or started, from a press or a read, and not on the first read", async () => {
    const server = memoryServer([OPEN, { ...FAILED, sessionId: "s-chat" }, FILED]);
    const list = vi.fn(server.api.list);
    const store = createSuggestionsStore({ ...server.api, list }, () => ({}));
    const filed = vi.fn();
    store.onFiled(filed);
    await store.refresh();
    expect(filed).not.toHaveBeenCalled();
    await store.file(OPEN.id);
    expect(filed).toHaveBeenLastCalledWith([expect.objectContaining({ id: OPEN.id })]);
    // Filed elsewhere: the next read brings it.
    list.mockResolvedValueOnce(server.records().map((record) => record.id === FAILED.id ? { ...record, revision: 9, state: { ...STARTED.state } } : record));
    await store.refresh();
    expect(filed).toHaveBeenCalledTimes(2);
    expect(filed).toHaveBeenLastCalledWith([expect.objectContaining({ id: FAILED.id })]);
    await store.refresh();
    expect(filed).toHaveBeenCalledTimes(2);
  });

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

  it("files several one at a time, in the order given, holding every one's buttons from the start", async () => {
    const second = { ...OPEN, id: "sg-second" };
    const server = memoryServer([OPEN, second, DUPLICATE]);
    const store = createSuggestionsStore(server.api, () => ({ sessionId: "s-chat" }));
    await store.refresh();
    const pending: string[][] = [];
    store.subscribe(() => pending.push(Object.keys(store.getSnapshot().pending)));
    server.refuse(OPEN.id, { status: 502, message: "GitHub did not answer." });
    const filed = await store.fileAll([second.id, OPEN.id, DUPLICATE.id]);
    expect(server.presses.map((press) => press.id)).toEqual([second.id, OPEN.id, DUPLICATE.id]);
    expect(pending[2]).toEqual([second.id, OPEN.id, DUPLICATE.id]);
    // A refusal stops only its own record.
    expect(filed.map((record) => record.id)).toEqual([second.id, DUPLICATE.id]);
    expect(store.getSnapshot().problems).toEqual({ [OPEN.id]: "GitHub did not answer." });
    expect(store.getSnapshot().pending).toEqual({});
  });

  it("files and acts on several with one model for all, and skips one already in flight", async () => {
    const second = { ...OPEN, id: "sg-second" };
    const server = memoryServer([OPEN, second]);
    const store = createSuggestionsStore(server.api, () => ({ sessionId: "s-chat" }));
    await store.refresh();
    const busy = store.file(OPEN.id);
    await store.fileAndActAll([OPEN.id, second.id], { modelSpec: "google/gemini-3-8-flash" });
    await busy;
    expect(server.presses).toEqual([
      { id: OPEN.id, kind: "file", request: {} },
      { id: second.id, kind: "file-and-act", request: { modelSpec: "google/gemini-3-8-flash" } },
    ]);
  });

  it("files for this chat, then hands over only what it filed, in order", async () => {
    const second = { ...OPEN, id: "sg-second", title: "Second" };
    const server = memoryServer([OPEN, second]);
    const store = createSuggestionsStore(server.api, () => ({ sessionId: "s-chat" }));
    await store.refresh();
    const deliver = vi.fn(async () => undefined);
    server.refuse(OPEN.id, { status: 502, message: "Offline." });
    await store.fileHere([second.id, OPEN.id], deliver);
    expect(server.presses.map((press) => press.kind)).toEqual(["file", "file"]);
    expect(deliver).toHaveBeenCalledWith([expect.objectContaining({ id: second.id, state: expect.objectContaining({ kind: "filed" }) })]);
    // Nothing filed: nothing to hand over.
    server.refuse(OPEN.id, { status: 502, message: "Offline." });
    await store.fileHere([OPEN.id], deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
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

describe("the filed item in the backlog", () => {
  it("is the project's Markdown item at that path in its main checkout, whatever the leading ./", () => {
    const item = (projectId: string, path: string, provider = "markdown") => ({ id: `${projectId}:${path}`, title: "T", provider, path, status: "", labels: [], assignedToMe: false,
      assignees: [], open: true, readiness: "ready", blockingIds: [], destination: { kind: "routed", projectId, reason: "project-owned" },
      owner: { kind: "project", projectId, projectName: projectId, repo: `/code/${projectId}` }, projectId, projectName: projectId, repo: `/code/${projectId}` }) as BacklogItem;
    const items = [item("other", ".forgerie/backlog/a.md"), item("p", ".forgerie/backlog/a.md", "github"), item("p", ".forgerie/backlog/a.md")];
    expect(filedItemOf(items, "p", "./.forgerie/backlog/a.md")?.id).toBe("p:.forgerie/backlog/a.md");
    expect(filedItemOf(items, "p", ".forgerie/backlog/a.md")?.provider).toBe("markdown");
    expect(filedItemOf(items, "p", ".forgerie/backlog/b.md")).toBeUndefined();
    expect(filedItemOf(undefined, "p", ".forgerie/backlog/a.md")).toBeUndefined();
  });
});
