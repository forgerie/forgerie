import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createDeferredFiles, createNewSessionApi, newStartupToken, defaultDestinationCwd, destinationLabel, folderName, keepChoice, thinkingLevelsFor, type Project, type Workspace } from "./newSession";

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
  async function server(behavior: { start?: number | "drop"; prompt?: number | "drop"; startError?: string; save?: number }) {
    const requests: { path: string; body: unknown }[] = [];
    const http = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const path = new URL(request.url ?? "/", "http://x").pathname;
      requests.push({ path, body });
      const send = (code: number, data: unknown) => { response.writeHead(code, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
      if (path.endsWith("/attachments")) {
        if (behavior.save) { send(behavior.save, { error: "The workspace is read only." }); return; }
        const files = (body as { attachments: { name: string; mimeType: string }[] }).attachments;
        send(200, { attachments: files.map((file) => ({ path: `.forgerie/attachments/${file.name}`, mimeType: file.mimeType, size: 5 })) });
        return;
      }
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

  it("labels the start so its progress can be followed, sends images with the message, and saves files to the folder first", async () => {
    const { api, requests } = await server({});
    const image = { kind: "image" as const, mimeType: "image/png", data: "cmVk", name: "shot.png" };
    const file = { kind: "file" as const, mimeType: "text/plain", data: "bm90ZXM=", name: "notes.txt" };
    const result = await api.start("/code/forgerie", { text: "Review these", images: [image], files: [file] }, {}, { startupToken: "t-1" });
    expect(result.type).toBe("started");
    expect(requests.map((request) => request.path)).toEqual(["/api/sessions", "/api/sessions/new-1/attachments", "/api/sessions/new-1/prompt"]);
    expect(requests[0]!.body).toEqual({ cwd: "/code/forgerie", startupToken: "t-1" });
    expect(requests[1]!.body).toEqual({ cwd: "/code/forgerie", attachments: [file] });
    expect(requests[2]!.body).toEqual({ cwd: "/code/forgerie", text: "Review these\n@.forgerie/attachments/notes.txt", attachments: [image] });
  });

  it("starts a skill or prompt template through its own route, with the identity the folder listed", async () => {
    const { api, requests } = await server({});
    const identity = { source: "skill" as const, name: "skill:testing", fingerprint: "f1" };
    await api.start("/code/forgerie", { text: "/skill:testing add cases", command: identity }, {});
    expect(requests[1]).toEqual({ path: "/api/sessions/new-1/prompt-resource-command",
      body: { cwd: "/code/forgerie", text: "/skill:testing add cases", identity } });
  });

  it("reports a session that exists without its message when its files could not be saved", async () => {
    const { api, requests } = await server({ save: 500 });
    const result = await api.start("/code/forgerie", { text: "hi", files: [{ kind: "file", mimeType: "text/plain", data: "eA==", name: "x.txt" }] }, {});
    expect(result.type === "failed" && result.failure.stage === "prompt" && result.failure.message).toBe("The workspace is read only.");
    expect(requests.some((request) => request.path.endsWith("/prompt"))).toBe(false);
  });

  it("names the session it made when only the first message failed, and never sends it twice", async () => {
    const { api, requests } = await server({ prompt: "drop" });
    const result = await api.start("/code/forgerie", "hi", {});
    expect(result.type === "failed" && result.failure.stage === "prompt" && result.failure.session.id).toBe("new-1");
    expect(requests.filter((request) => request.path.endsWith("/prompt"))).toHaveLength(1);
  });
});

describe("first-prompt commands for a folder", () => {
  function api(routes: Record<string, unknown>) {
    const seen: string[] = [];
    const fetchFn = async (path: string) => {
      seen.push(path);
      const body = routes[path.split("?")[0]!];
      return body === undefined ? Response.json({ error: "no" }, { status: 404 }) : Response.json(body);
    };
    return { api: createNewSessionApi(fetchFn), seen };
  }
  const identity = { source: "skill", name: "skill:testing", fingerprint: "f1" };

  it("lists the folder's skills and prompt templates from its own workspace", async () => {
    const { api: client, seen } = api({
      "/api/projects": projects,
      "/api/projects/p1/workspaces": workspaces.map((item) => ({ ...item, projectId: "p1" })),
      "/api/projects/p1/workspaces/w2/prompt-resource-catalog": { available: true, diagnostics: [],
        commands: [{ name: "skill:testing", source: "skill", identity, description: "Write tests" }] },
    });
    const commands = await client.promptResources("/code/forgerie/.worktree/new-ui-mvp");
    expect(commands).toEqual([{ name: "skill:testing", source: "skill", identity, description: "Write tests" }]);
    expect(seen.at(-1)).toBe("/api/projects/p1/workspaces/w2/prompt-resource-catalog");
  });

  it("says why when the folder cannot list them", async () => {
    const { api: client } = api({
      "/api/projects": projects,
      "/api/projects/p1/workspaces": [{ ...workspaces[0], projectId: "p1" }],
      "/api/projects/p2/workspaces": [],
      "/api/projects/p1/workspaces/w1/prompt-resource-catalog": { available: false, reason: "busy", message: "Pi is busy. Try again." },
    });
    await expect(client.promptResources("/code/forgerie")).rejects.toThrow("Pi is busy. Try again.");
    await expect(client.promptResources("/nowhere")).rejects.toThrow(/registered workspace/u);
  });

  it("makes startup tokens without a secure context", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newStartupToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^start-[0-9a-f]{24}$/u);
  });
});

describe("files before the session exists", () => {
  it("holds a file behind a placeholder, and takes it back out of the sent text", async () => {
    const deferred = createDeferredFiles();
    const file = { kind: "file" as const, mimeType: "text/plain", data: "aGVsbG8=", name: "notes.txt" };
    const saved = await deferred.save(file);
    expect(saved).toMatchObject({ path: expect.stringMatching(/^pending-upload\/[0-9a-f]{24}\/notes.txt$/u), mimeType: "text/plain", size: 6 });
    expect(deferred.split(`Read this\n@${saved.path}`)).toEqual({ text: "Read this", files: [file] });
    // A typed mention that only looks like one stays text.
    expect(deferred.split("See @pending-upload/9/x.txt\n@src/app.ts")).toEqual({ text: "See @pending-upload/9/x.txt\n@src/app.ts", files: [] });
  });
});

describe("held files across windows", () => {
  it("gives every held file its own placeholder, even with the same name", async () => {
    const deferred = createDeferredFiles();
    const first = await deferred.save({ kind: "file", mimeType: "text/plain", data: "YQ==", name: "notes.txt" });
    const second = await deferred.save({ kind: "file", mimeType: "text/plain", data: "Yg==", name: "notes.txt" });
    expect(first.path).not.toBe(second.path);
    expect(deferred.split(`@${first.path}`).files[0]?.data).toBe("YQ==");
    // Still held after a send, so "Put back" and a second start find it.
    expect(deferred.split(`@${first.path}`).files[0]?.data).toBe("YQ==");
  });
});
