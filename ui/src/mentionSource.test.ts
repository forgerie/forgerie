import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createMentionSource } from "./mentionSource";

let server: Server | undefined;
afterEach(async () => { if (server) { server.closeAllConnections(); server.close(); await once(server, "close"); server = undefined; } });
async function service(routes: Record<string, unknown>, failures: Record<string, number> = {}) {
  const requests: { url: string; method: string }[] = [];
  server = createServer((req, res) => {
    const url = req.url!;
    requests.push({ url, method: req.method! });
    res.writeHead(failures[url] ?? (url in routes ? 200 : 404), { "content-type": "application/json" });
    res.end(JSON.stringify(routes[url] ?? { error: `Unknown route ${url}` }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { requests, source: createMentionSource({ id: "s/1", cwd: "/repo/work tree" }, (path, init) => fetch(base + path, init)) };
}
const modelPath = "/api/sessions/s%2F1/models?cwd=%2Frepo%2Fwork+tree";
const projects = [{ id: "p/1", path: "/repo" }, { id: "other", path: "/other" }];
const workspacePath = "/api/projects/p%2F1/workspaces";
const workspace = [{ id: "w/1", projectId: "p/1", path: "/repo/work tree/" }];

describe("mention discovery against Forgerie HTTP contracts", () => {
  it("resolves the session workspace once and sends the scope and encoded query", async () => {
    const filePath = "/api/projects/p%2F1/workspaces/w%2F1/files?q=src%2Fwith+space&scope=tracked";
    const allPath = "/api/projects/p%2F1/workspaces/w%2F1/files?q=vendor&scope=all";
    const { source, requests } = await service({ "/api/projects": projects, [workspacePath]: workspace,
      [filePath]: [{ path: "src/with space.ts", kind: "tracked" }], [allPath]: [{ path: "vendor/", kind: "other" }] });
    const signal = new AbortController().signal;
    expect(await source.files("src/with space", "tracked", signal)).toEqual([{ id: "src/with space.ts", type: "file", label: "src/with space.ts", description: "tracked" }]);
    expect(await source.files("vendor", "all", signal)).toEqual([{ id: "vendor/", type: "file", label: "vendor/", description: "other" }]);
    expect(requests.map((r) => r.url)).toEqual(["/api/projects", workspacePath, filePath, allPath]);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  });
  it("finds a registered worktree outside the project root, without using a parent workspace", async () => {
    const { source } = await service({ "/api/projects": projects, [workspacePath]: [{ id: "main", projectId: "p/1", path: "/repo" }],
      "/api/projects/other/workspaces": [{ id: "external", projectId: "other", path: "/repo/work tree" }],
      "/api/projects/other/workspaces/external/files?q=&scope=tracked": [] });
    expect(await source.files("", "tracked", new AbortController().signal)).toEqual([]);
  });
  it("filters names and qualified model IDs and inserts no session mutation", async () => {
    const { source, requests } = await service({ [modelPath]: { models: [
      { provider: "p", id: "fast", name: "Fast model" }, { provider: "p", id: "precise", name: "Careful" },
    ] } });
    expect(await source.models("CAREFUL", new AbortController().signal)).toEqual([{ id: "p/precise", type: "model", label: "p/precise", description: "Careful" }]);
    expect(requests).toEqual([{ url: modelPath, method: "GET" }]);
  });
  it("limits matches and reports server failures and invalid wire data", async () => {
    const { source } = await service({ [modelPath]: { models: Array.from({ length: 30 }, (_, i) => ({ provider: "p", id: `m${i}` })) } });
    expect(await source.models("", new AbortController().signal)).toHaveLength(12);
  });
  it("keeps server refusals observable", async () => {
    const { source } = await service({ [modelPath]: { error: "Models unavailable" } }, { [modelPath]: 503 });
    await expect(source.models("", new AbortController().signal)).rejects.toThrow("Models unavailable");
  });
  it("refuses a missing workspace instead of searching unrelated files", async () => {
    const { source } = await service({ "/api/projects": projects, [workspacePath]: [], "/api/projects/other/workspaces": [] });
    await expect(source.files("", "tracked", new AbortController().signal)).rejects.toThrow("registered workspace");
  });
  it("rejects invalid model identities", async () => {
    const { source } = await service({ [modelPath]: { models: [{ provider: "", id: "bad" }] } });
    await expect(source.models("", new AbortController().signal)).rejects.toThrow();
  });
  it("cancels a request before it can discover or select from another session", async () => {
    const { source, requests } = await service({ [modelPath]: { models: [] } });
    const controller = new AbortController(); controller.abort();
    await expect(source.models("", controller.signal)).rejects.toThrow();
    expect(requests).toEqual([]);
  });
});
