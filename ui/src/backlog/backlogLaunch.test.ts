import { describe, expect, it } from "vitest";
import { createNewSessionApi } from "../newSession";
import { createLaunchStore } from "../launches";
import { createBacklogApi } from "./backlogApi";

type Call = { path: string; body?: unknown };
function server(reply: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchFn = async (path: string, init?: RequestInit) => {
    const call = { path, ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}) };
    calls.push(call);
    const { status = 200, body } = reply(call);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetchFn };
}
const claim = { kind: "claimed", claimId: "c1", requestId: "r", fingerprint: "f", projectId: "p1", itemId: "01A", repo: "/code/forgerie",
  cwd: "/code/forgerie/.worktree/s-1", claimedAt: "2026-10-07T10:00:00Z", sessionId: "s-held" };

describe("starting a session from a backlog item", () => {
  it("claims through the launch route, then sends the item and the author's words as the first message", async () => {
    const { calls, fetchFn } = server(({ path }) => path.endsWith("/launch")
      ? { body: { session: { id: "s1", cwd: "/code/forgerie/.worktree/s-1" }, claim: { ...claim, sessionId: "s1" }, initialPrompt: "This is backlog item 01A.\n\n# Fix", reused: false } }
      : { body: { accepted: true } });
    const api = createNewSessionApi(fetchFn);
    const result = await api.start("/code/forgerie", { text: "Start with the scanner." }, { model: { provider: "p", id: "opus" }, thinkingLevel: "high" },
      { startupToken: "start-1", destination: { kind: "fresh-worktree" }, item: { projectId: "p1", itemId: "01A" } });
    expect(result).toEqual({ type: "started", session: { id: "s1", cwd: "/code/forgerie/.worktree/s-1" } });
    expect(calls[0]).toEqual({ path: "/api/backlog/p1/items/01A/launch", body: { requestId: "start-1",
      start: { cwd: "/code/forgerie", modelSpec: "p/opus", thinkingLevel: "high", destination: { kind: "fresh-worktree" } } } });
    expect(calls[1]).toEqual({ path: "/api/sessions/s1/prompt", body: { cwd: "/code/forgerie/.worktree/s-1", text: "This is backlog item 01A.\n\n# Fix\n\nStart with the scanner." } });
    expect(calls.some((call) => call.path === "/api/sessions")).toBe(false);
  });

  it("reports an item another session took, and that nothing started", async () => {
    const { calls, fetchFn } = server(() => ({ status: 409, body: { kind: "conflict", error: "Backlog item is already claimed", claim } }));
    const store = createLaunchStore<string>(createNewSessionApi(fetchFn));
    const { done } = store.launch("/code/forgerie", { text: "" }, {}, "draft", { item: { projectId: "p1", itemId: "01A" }, title: "Fix the scanner" });
    expect(store.getSnapshot()[0]!.title).toBe("Fix the scanner");
    const outcome = await done;
    expect(outcome).toMatchObject({ type: "failed", maybeStarted: false, taken: { sessionId: "s-held" },
      error: "Another session took this item first, so this session did not start." });
    expect(calls).toHaveLength(1);
  });

  it("says a failed claim may have started something only when the server could not tell", async () => {
    const refusal = (status: number, kind: string) => {
      const { fetchFn } = server(() => ({ status, body: { kind, error: "no" } }));
      return createNewSessionApi(fetchFn).start("/r", "go", {}, { item: { projectId: "p1", itemId: "01A" } });
    };
    expect(await refusal(400, "invalid-request")).toMatchObject({ type: "failed", failure: { stage: "start", maybeStarted: false } });
    expect(await refusal(409, "conflict")).toMatchObject({ type: "failed", failure: { stage: "start", maybeStarted: false } });
    expect(await refusal(503, "unavailable")).toMatchObject({ type: "failed", failure: { stage: "start", maybeStarted: true } });
  });

  it("lets a skill lead the message, with the item as its arguments", async () => {
    const { calls, fetchFn } = server(({ path }) => path.endsWith("/launch")
      ? { body: { session: { id: "s1", cwd: "/r" }, claim: { ...claim, sessionId: "s1" }, initialPrompt: "This is backlog item 01A.", reused: false } }
      : { body: { accepted: true } });
    const identity = { source: "skill" as const, name: "skill:tdd", fingerprint: "x" };
    await createNewSessionApi(fetchFn).start("/r", { text: "/skill:tdd", command: identity }, {}, { item: { projectId: "p1", itemId: "01A" } });
    expect(calls[1]).toEqual({ path: "/api/sessions/s1/prompt-resource-command", body: { cwd: "/r", text: "/skill:tdd\n\nThis is backlog item 01A.", identity } });
  });
});

describe("the backlog client", () => {
  it("keeps the readable items when one is malformed, and reads an unknown readiness as blocked", async () => {
    const good = { id: "01A", title: "Fix", projectId: "p1", projectName: "forgerie", repo: "/r", path: "a.md", status: "To Do", labels: [], blocked_by: [],
      open: true, readiness: "ready", blockingIds: [] };
    const { fetchFn } = server(() => ({ body: { items: [good, { id: "bad" }, { ...good, id: "02B", readiness: "someday" }], warnings: [], generatedAt: "now" } }));
    const list = await createBacklogApi(fetchFn).list();
    expect(list.items.map((item) => [item.id, item.readiness])).toEqual([["01A", "ready"], ["02B", "blocked"]]);
  });
  it("carries the server's refusal and the claim that holds the item", async () => {
    const { fetchFn } = server(() => ({ status: 409, body: { kind: "conflict", error: "Backlog item is already claimed", claim } }));
    await expect(createBacklogApi(fetchFn).launch("p1", "01A", "r", { cwd: "/r" })).rejects.toMatchObject({ kind: "conflict", status: 409, claim: { sessionId: "s-held" } });
  });
});
