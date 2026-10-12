import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createMentionSource, type ModelSuggestions } from "./mentionSource";

const ids = (found: ModelSuggestions) => found.groups.flatMap((group) => group.options.map((option) => option.id));

let server: Server | undefined;
afterEach(async () => { if (server) { server.closeAllConnections(); server.close(); await once(server, "close"); server = undefined; } });
async function service(routes: Record<string, unknown>, failures: Record<string, number> = {}, modelsPath?: string) {
  const requests: { url: string; method: string }[] = [];
  routes = { [prefsPath]: prefs, ...routes };
  server = createServer((req, res) => {
    const url = req.url!;
    requests.push({ url, method: req.method! });
    res.writeHead(failures[url] ?? (url in routes ? 200 : 404), { "content-type": "application/json" });
    res.end(JSON.stringify(routes[url] ?? { error: `Unknown route ${url}` }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { requests, source: createMentionSource({ id: "s/1", cwd: "/repo/work tree" }, (path, init) => fetch(base + path, init), modelsPath) };
}
const modelPath = "/api/sessions/s%2F1/models?cwd=%2Frepo%2Fwork+tree";
const prefsPath = "/aui/model-prefs";
const prefs = { revision: "r1", favorites: [], visible: null, defaultModel: null, defaultThinkingLevel: null, titleModel: null, configPath: "/config/config.json",
  favoritesPath: "/agent/settings.json", visiblePath: "/config/visible-models.json", home: "/home/me" };
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
  it("groups suggestions like the model menu: favorites first in Settings order, hidden models out", async () => {
    const { source } = await service({ [prefsPath]: { ...prefs, favorites: ["p/favorite-b:high", "favorite-a"], visible: ["p/shown"] },
      [modelPath]: { models: [
        ...Array.from({ length: 15 }, (_, i) => ({ provider: "p", id: `hidden-${i}` })),
        { provider: "p", id: "shown", contextWindow: 200_000 }, { provider: "p", id: "favorite-a" }, { provider: "p", id: "favorite-b", reasoning: false },
      ] } });
    const signal = new AbortController().signal;
    const all = await source.models("", { showHidden: false }, signal);
    expect(all.groups.map((group) => [group.label, ...group.options.map((option) => option.id)]))
      .toEqual([["Favorites", "p/favorite-b", "p/favorite-a"], ["P", "p/shown"]]);
    expect(all.hidden).toBe(15);
    expect(all.toggle).toEqual({ show: "Show 15 hidden models", hide: "Hide models you do not show" });
    expect(all.groups[0]!.options[0]).toMatchObject({ details: ["P", "no thinking"], tone: "quiet" });
    expect(all.groups[1]!.options[0]!.details).toEqual(["200k context"]);
    expect(ids(await source.models("hidden", { showHidden: false }, signal))).toEqual([]);
    expect(ids(await source.models("FAVORITE", { showHidden: false }, signal))).toEqual(["p/favorite-b", "p/favorite-a"]);
  });
  it("states each model's levels, and the level a favorite saved with it", async () => {
    const { source } = await service({ [prefsPath]: { ...prefs, favorites: ["p/deep:high"] },
      [modelPath]: { models: [{ provider: "p", id: "deep" }, { provider: "p", id: "plain", reasoning: false }] } });
    const { thinking } = await source.models("", { showHidden: false }, new AbortController().signal);
    expect(thinking["p/deep"]).toEqual({ preset: "high", levels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
      .map((value) => ({ value, label: expect.any(String) as unknown as string })) });
    expect(thinking["p/deep"]!.levels[5]).toEqual({ value: "xhigh", label: "Extra high" });
    expect(thinking["p/plain"]).toEqual({ levels: [{ value: "off", label: "Off" }], preset: undefined });
  });
  it("lists one model's levels after a colon, filtered by what follows it", async () => {
    const { source } = await service({ [prefsPath]: { ...prefs, favorites: ["p/deep:high"] }, [modelPath]: { models: [
      { provider: "p", id: "deep", name: "Deep" }, { provider: "p", id: "deeper", name: "Deeper" }, { provider: "local", id: "llama3:8b" },
    ] } });
    const signal = new AbortController().signal;
    const exact = await source.models("p/deep:", { showHidden: false }, signal);
    expect(exact.groups).toHaveLength(1);
    expect(exact.groups[0]!.label).toBe("Thinking for Deep");
    expect(ids(exact)).toEqual(["p/deep:off", "p/deep:minimal", "p/deep:low", "p/deep:medium", "p/deep:high", "p/deep:xhigh", "p/deep:max"]);
    expect(exact.groups[0]!.options.find((option) => option.current)?.id).toBe("p/deep:high");
    // A partial level filters by Pi's word or the label a person reads.
    expect(ids(await source.models("p/deep:hi", { showHidden: false }, signal))).toEqual(["p/deep:high"]);
    expect(ids(await source.models("p/deep:extra", { showHidden: false }, signal))).toEqual(["p/deep:xhigh"]);
    // Search text resolves to the model the highlight was on, else the first match.
    expect(ids(await source.models("dee:max", { showHidden: false, prefer: "p/deeper" }, signal))).toEqual(["p/deeper:max"]);
    expect(ids(await source.models("dee:max", { showHidden: false }, signal))).toEqual(["p/deep:max"]);
    // A colon that belongs to the model ID is a search, not a level.
    expect(ids(await source.models("llama3:8b", { showHidden: false }, signal))).toEqual(["local/llama3:8b"]);
  });
  it("offers hidden models on request, marked as hidden", async () => {
    const { source } = await service({ [prefsPath]: { ...prefs, visible: ["p/shown"] },
      [modelPath]: { models: [{ provider: "p", id: "shown" }, { provider: "p", id: "off" }] } });
    const found = await source.models("", { showHidden: true }, new AbortController().signal);
    expect(ids(found)).toEqual(["p/shown", "p/off"]);
    expect(found.groups[0]!.options[1]).toMatchObject({ tone: "faint", details: ["hidden"] });
  });
  it("filters names and qualified model IDs and inserts no session mutation", async () => {
    const { source, requests } = await service({ [modelPath]: { models: [
      { provider: "p", id: "fast", name: "Fast model" }, { provider: "p", id: "precise", name: "Careful" },
    ] } });
    expect(ids(await source.models("CAREFUL", { showHidden: false }, new AbortController().signal))).toEqual(["p/precise"]);
    expect(requests).toHaveLength(2);
    expect(requests).toEqual(expect.arrayContaining([{ url: modelPath, method: "GET" }, { url: prefsPath, method: "GET" }]));
    expect(ids(await source.models("P/PRECISE", { showHidden: false }, new AbortController().signal))).toEqual(["p/precise"]);
  });
  it("reads Settings again on each search without recreating the source", async () => {
    const stored = { ...prefs, visible: ["p/first"] };
    const { source } = await service({ [prefsPath]: stored, [modelPath]: { models: [
      { provider: "p", id: "first" }, { provider: "p", id: "second" },
    ] } });
    const signal = new AbortController().signal;
    expect(ids(await source.models("", { showHidden: false }, signal))).toEqual(["p/first"]);
    stored.visible = ["p/second"];
    expect(ids(await source.models("", { showHidden: false }, signal))).toEqual(["p/second"]);
  });
  it("applies the same preferences before a new session exists", async () => {
    const path = "/api/models?cwd=%2Frepo%2Fwork+tree";
    const { source } = await service({ [prefsPath]: { ...prefs, favorites: ["p/chosen"], visible: [] }, [path]: { models: [
      { provider: "p", id: "hidden" }, { provider: "p", id: "chosen" },
    ] } }, {}, path);
    expect(ids(await source.models("", { showHidden: false }, new AbortController().signal))).toEqual(["p/chosen"]);
  });
  it("reports preference failures instead of offering hidden models", async () => {
    const { source } = await service({ [prefsPath]: { error: "Model settings unavailable" }, [modelPath]: { models: [{ provider: "p", id: "hidden" }] } },
      { [prefsPath]: 503 });
    await expect(source.models("", { showHidden: false }, new AbortController().signal)).rejects.toThrow("Model settings unavailable");
  });
  it("rejects invalid preference data instead of ignoring the shown list", async () => {
    const { source } = await service({ [prefsPath]: { ...prefs, visible: "p/hidden" }, [modelPath]: { models: [] } });
    await expect(source.models("", { showHidden: false }, new AbortController().signal)).rejects.toThrow();
  });
  it("offers every shown model, as the model menu does, and lets the list scroll", async () => {
    const { source } = await service({ [modelPath]: { models: Array.from({ length: 30 }, (_, i) => ({ provider: "p", id: `m${i}` })) } });
    expect(ids(await source.models("", { showHidden: false }, new AbortController().signal))).toHaveLength(30);
  });
  it("keeps server refusals observable", async () => {
    const { source } = await service({ [modelPath]: { error: "Models unavailable" } }, { [modelPath]: 503 });
    await expect(source.models("", { showHidden: false }, new AbortController().signal)).rejects.toThrow("Models unavailable");
  });
  it("refuses a missing workspace instead of searching unrelated files", async () => {
    const { source } = await service({ "/api/projects": projects, [workspacePath]: [], "/api/projects/other/workspaces": [] });
    await expect(source.files("", "tracked", new AbortController().signal)).rejects.toThrow("registered workspace");
  });
  it("rejects invalid model identities", async () => {
    const { source } = await service({ [modelPath]: { models: [{ provider: "", id: "bad" }] } });
    await expect(source.models("", { showHidden: false }, new AbortController().signal)).rejects.toThrow();
  });
  it("cancels a request before it can discover or select from another session", async () => {
    const { source, requests } = await service({ [modelPath]: { models: [] } });
    const controller = new AbortController(); controller.abort();
    await expect(source.models("", { showHidden: false }, controller.signal)).rejects.toThrow();
    expect(requests).toEqual([]);
  });
});
