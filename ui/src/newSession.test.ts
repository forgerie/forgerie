import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createNewSessionApi, defaultDestinationCwd, destinationLabel, folderName, keepChoice, thinkingLevelsFor, type Project, type Workspace } from "./newSession";

const projects: Project[] = [
  { id: "p1", name: "forgerie", path: "/code/forgerie" },
  { id: "p2", name: "korri", path: "/code/korri" },
];
const workspaces: Workspace[] = [
  { id: "w1", path: "/code/forgerie", label: "main", branch: "main", isMain: true },
  { id: "w2", path: "/code/forgerie/.worktree/new-ui-mvp", label: "new-ui-mvp", branch: "new-ui-mvp", isMain: false },
];

describe("destination", () => {
  it("names a folder by its project, then its workspace branch", () => {
    expect(destinationLabel("/code/forgerie", projects, workspaces)).toBe("forgerie");
    expect(destinationLabel("/code/forgerie/.worktree/new-ui-mvp", projects, workspaces)).toBe("forgerie · new-ui-mvp");
    expect(destinationLabel("/code/forgerie/.worktree/other", projects)).toBe("forgerie · other");
    expect(destinationLabel("/tmp/scratch", projects)).toBe("scratch");
    expect(folderName("/tmp/scratch/")).toBe("scratch");
  });

  it("starts where the reader is: the open session, then the latest session, then the first project", () => {
    const recent = [{ cwd: "/code/korri", modified: "2026-10-01T00:00:00Z" }, { cwd: "/code/forgerie", modified: "2026-10-05T00:00:00Z" }];
    expect(defaultDestinationCwd({ cwd: "/tmp/open" }, recent, projects)).toBe("/tmp/open");
    expect(defaultDestinationCwd(undefined, recent, projects)).toBe("/code/forgerie");
    expect(defaultDestinationCwd(undefined, [], projects)).toBe("/code/forgerie");
    expect(defaultDestinationCwd(undefined, [], [])).toBeUndefined();
  });
});

describe("agent choice", () => {
  const opus = { provider: "a", id: "opus", reasoning: true };
  it("offers every level for a reasoning model, and only off for a plain one", () => {
    expect(thinkingLevelsFor(opus)).toContain("xhigh");
    expect(thinkingLevelsFor({ provider: "a", id: "plain", reasoning: false })).toEqual(["off"]);
    expect(thinkingLevelsFor(undefined)).toContain("medium");
  });
  it("keeps a chosen model only where the new folder offers it", () => {
    expect(keepChoice({ model: opus, thinkingLevel: "high" }, [opus])).toEqual({ model: opus, thinkingLevel: "high" });
    expect(keepChoice({ model: opus, thinkingLevel: "high" }, [])).toEqual({ thinkingLevel: "high" });
  });
});

describe("starting a session", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });
  async function server(behavior: { start?: number | "drop"; prompt?: number | "drop"; startError?: string }) {
    const requests: { path: string; body: unknown }[] = [];
    const http = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const path = new URL(request.url ?? "/", "http://x").pathname;
      requests.push({ path, body });
      const send = (code: number, data: unknown) => { response.writeHead(code, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
      const outcome = path === "/api/sessions" ? behavior.start : behavior.prompt;
      if (outcome === "drop") { response.destroy(); return; }
      if (outcome !== undefined) { send(outcome, { error: path === "/api/sessions" && behavior.startError ? behavior.startError : `refused with ${outcome}` }); return; }
      if (path === "/api/sessions") send(200, { id: "new-1", cwd: (body as { cwd: string }).cwd, path: "/x.jsonl" });
      else send(200, { accepted: true });
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("No port");
    cleanup.push(async () => { http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); });
    const api = createNewSessionApi((path, init) => fetch(`http://127.0.0.1:${address.port}${path}`, init));
    return { api, requests };
  }
  const opus = { provider: "cliproxyapi", id: "claude-opus-5-5", reasoning: true };

  it("creates the session with the chosen model and level, then sends the first message", async () => {
    const { api, requests } = await server({});
    const result = await api.start("/code/forgerie", "Fix the build", { model: opus, thinkingLevel: "high" });
    expect(result).toEqual({ type: "started", session: { id: "new-1", cwd: "/code/forgerie" } });
    expect(requests.map((request) => request.path)).toEqual(["/api/sessions", "/api/sessions/new-1/prompt"]);
    expect(requests[0]!.body).toMatchObject({ cwd: "/code/forgerie", modelSpec: "cliproxyapi/claude-opus-5-5", thinkingLevel: "high" });
    expect(requests[1]!.body).toEqual({ cwd: "/code/forgerie", text: "Fix the build" });
  });

  it("leaves Pi's defaults alone when nothing was chosen", async () => {
    const { api, requests } = await server({});
    await api.start("/code/forgerie", "hi", {});
    expect(Object.keys(requests[0]!.body as object).sort()).toEqual(["cwd"]);
  });

  it("says a request the server rejected made no session; a start failure, a 400 from inside the start, or a lost reply may have", async () => {
    const refused = await (await server({ start: 400, startError: 'Unknown model "x/y". Pass an exact "provider/model-id".' })).api.start("/code/forgerie", "hi", {});
    expect(refused).toEqual({ type: "failed", failure: { stage: "start", message: 'Unknown model "x/y". Pass an exact "provider/model-id".', maybeStarted: false } });
    // The real route answers 400 for a missing folder too, after it has written a session file.
    const inside = await (await server({ start: 400, startError: "Stored session working directory does not exist: /nowhere" })).api.start("/nowhere", "hi", {});
    expect(inside.type === "failed" && inside.failure.stage === "start" && inside.failure.maybeStarted).toBe(true);
    const lost = await server({ start: "drop" });
    const result = await lost.api.start("/code/forgerie", "hi", {});
    expect(result.type === "failed" && result.failure.stage === "start" && result.failure.maybeStarted).toBe(true);
    expect(lost.requests).toHaveLength(1);
  });

  it("names the session it made when only the first message failed, and never sends it twice", async () => {
    const { api, requests } = await server({ prompt: "drop" });
    const result = await api.start("/code/forgerie", "hi", {});
    expect(result.type === "failed" && result.failure.stage === "prompt" && result.failure.session.id).toBe("new-1");
    expect(requests.filter((request) => request.path.endsWith("/prompt"))).toHaveLength(1);
  });
});
