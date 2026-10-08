import { describe, expect, it } from "vitest";
import { createNewSessionApi } from "../newSession";
import { createLaunchStore } from "../launches";
import { createBacklogApi } from "./backlogApi";
import { createGitHubApi, readSetupReturn, submitToGitHub } from "./githubApi";

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
  it("names the provider for every route of a GitHub issue, and none for a file, so older servers still answer", async () => {
    const { calls, fetchFn } = server(({ path }) => path.includes("/launch")
      ? { body: { session: { id: "s1", cwd: "/code/korri" }, claim: { ...claim, provider: "github", itemId: "7", sessionId: "s1" }, initialPrompt: "This is GitHub issue korri-os/korri#7.", reused: false } }
      : { body: { accepted: true } });
    const api = createNewSessionApi(fetchFn);
    await api.start("/code/korri", { text: "" }, {}, { startupToken: "start-7", item: { projectId: "p1", itemId: "7", provider: "github" } });
    expect(calls[0]!.path).toBe("/api/backlog/p1/items/7/launch?provider=github");
    const paths = server(() => ({ body: { released: true } }));
    await createBacklogApi(paths.fetchFn).release({ projectId: "p1", itemId: "7", provider: "github" }, "c1");
    await createBacklogApi(paths.fetchFn).release({ projectId: "p1", itemId: "01A", provider: "markdown" }, "c2");
    expect(paths.calls.map((call) => call.path)).toEqual(["/api/backlog/p1/items/7/release?provider=github", "/api/backlog/p1/items/01A/release"]);
  });
  it("keeps Azure's organization-qualified identity through launch and release", async () => {
    const { calls, fetchFn } = server(({ path }) => path.includes("/launch")
      ? { body: { session: { id: "s1", cwd: "/code/amaze" }, claim: { ...claim, provider: "azure-devops", itemId: "amazeinsights:7", sessionId: "s1" }, initialPrompt: "Azure work item context", reused: false } }
      : { body: { accepted: true } });
    await createNewSessionApi(fetchFn).start("/code/amaze", { text: "Check the totals." }, {},
      { startupToken: "azure-7", item: { projectId: "p1", itemId: "amazeinsights:7", provider: "azure-devops" } });
    expect(calls[0]!.path).toBe("/api/backlog/p1/items/amazeinsights%3A7/launch?provider=azure-devops");
    expect(calls[1]!.body).toMatchObject({ text: "Azure work item context\n\nCheck the totals." });
    const paths = server(() => ({ body: { released: true } }));
    await createBacklogApi(paths.fetchFn).release({ projectId: "p1", itemId: "amazeinsights:7", provider: "azure-devops" }, "c1");
    expect(paths.calls[0]!.path).toBe("/api/backlog/p1/items/amazeinsights%3A7/release?provider=azure-devops");
  });
  it("reads an item from a server older than providers as markdown", async () => {
    const { fetchFn } = server(() => ({ body: { items: [{ id: "01A", title: "Fix", projectId: "p1", projectName: "forgerie", repo: "/r", path: "a.md", status: "To Do",
      labels: [], open: true, readiness: "ready", blockingIds: [], claim: { ...claim, provider: undefined } }], warnings: [], generatedAt: "now" } }));
    const list = await createBacklogApi(fetchFn).list();
    expect(list.items[0]).toMatchObject({ provider: "markdown", claim: { provider: "markdown" } });
  });
  it("reads a server without GitHub App setup as not set up, and carries a refused setup's reason", async () => {
    const missing = async () => new Response("{}", { status: 404 });
    expect(await createGitHubApi(missing).status()).toEqual({ state: "not-configured" });
    const refused = async () => new Response(JSON.stringify({ error: "This GitHub setup did not start here. Start the setup again." }), { status: 400 });
    await expect(createGitHubApi(refused).created("c", "forgerie-x")).rejects.toThrow("Start the setup again");
  });
  it("sends the page's origin, and refuses a setup form aimed anywhere but github.com", async () => {
    const { calls, fetchFn } = server(() => ({ body: { action: "https://github.com/settings/apps/new?state=forgerie-1", manifest: "{}" } }));
    expect(await createGitHubApi(fetchFn).setup("https://forgerie.tail.ts.net")).toEqual({ action: "https://github.com/settings/apps/new?state=forgerie-1", manifest: "{}" });
    expect(calls[0]).toEqual({ path: "/api/github/app/setup", body: { origin: "https://forgerie.tail.ts.net" } });
    const evil = server(() => ({ body: { action: "https://evil.example/steal?state=forgerie-1", manifest: "{}" } }));
    await expect(createGitHubApi(evil.fetchFn).setup("https://forgerie.tail.ts.net")).rejects.toThrow();
  });
  it("reads only Forgerie's own return from GitHub", () => {
    expect(readSetupReturn("?code=abc&state=forgerie-0123")).toEqual({ code: "abc", state: "forgerie-0123" });
    expect(readSetupReturn("?code=abc&state=someone-else")).toBeUndefined();
    expect(readSetupReturn("?backlog")).toBeUndefined();
  });
  it("posts the manifest to GitHub as a form field", () => {
    let submitted: { method: string; action: string; manifest: string | undefined } | undefined;
    const form = { method: "", action: "", fields: [] as { name: string; value: string }[], append(field: { name: string; value: string }) { this.fields.push(field); },
      submit() { submitted = { method: this.method, action: this.action, manifest: this.fields.find((field) => field.name === "manifest")?.value }; } };
    const doc = { createElement: (tag: string) => tag === "form" ? form : { type: "", name: "", value: "" }, body: { append: () => undefined } };
    submitToGitHub({ action: "https://github.com/settings/apps/new?state=forgerie-1", manifest: "{\"name\":\"Forgerie (zao)\"}" }, doc as unknown as Document);
    expect(submitted).toEqual({ method: "post", action: "https://github.com/settings/apps/new?state=forgerie-1", manifest: "{\"name\":\"Forgerie (zao)\"}" });
  });
  it("carries the server's refusal and the claim that holds the item", async () => {
    const { fetchFn } = server(() => ({ status: 409, body: { kind: "conflict", error: "Backlog item is already claimed", claim } }));
    await expect(createBacklogApi(fetchFn).launch({ projectId: "p1", itemId: "01A" }, "r", { cwd: "/r" })).rejects.toMatchObject({ kind: "conflict", status: 409, claim: { sessionId: "s-held" } });
  });
});
