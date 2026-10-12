import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerUiSettingsRoutes } from "./routes.js";
import { defaultAgentDirs } from "./agentFiles.js";

const apps: FastifyInstance[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A Forgerie server whose own API reports `dir` as sessiond's profile and `global` as a stale config value. */
async function settingsServer(options: { available?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "settings-http-")); roots.push(root);
  const dir = join(root, "owned-profile"); const global = join(root, "terminal-profile"); const home = join(root, "home", ".agents");
  await mkdir(join(dir, "agents"), { recursive: true }); await mkdir(global); await mkdir(home, { recursive: true });
  await writeFile(join(global, "sentinel"), "unchanged");
  await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: [], enabledModels: ["proxy/a"] }));
  const configPath = join(root, "config.json"); await writeFile(configPath, "{}");
  const app = Fastify({ logger: false }); apps.push(app);
  app.get("/api/pi-web/runtime", () => ({ components: { sessiond: { available: options.available ?? true, activeAgentProfile: { dir, command: "pi", revision: "runtime" } } } }));
  app.get("/api/config", () => ({ path: configPath, config: { agent: { dir: global } } }));
  app.get("/api/plugins", () => ({ plugins: [] }));
  const restarts: number[] = [];
  await registerUiSettingsRoutes(app, { agentDirs: async (gateway) => ({ ...await defaultAgentDirs(gateway), home }), pluginServices: { read: () => Promise.resolve({ available: true, stamp: ["1", "1"] }), restart: () => { restarts.push(1); return Promise.resolve(); } } });
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url, headers: { "content-type": "application/json", ...headers }, payload: JSON.stringify(body) });
  return { app, dir, global, home, restarts, post };
}

describe("settings HTTP routes", () => {
  it("writes Agents and Plugins to the same daemon profile and refuses unsafe plugin requests", async () => {
    const { app, dir, global, restarts, post } = await settingsServer();
    const agents: { userDir: string; agents: { scope: string }[] } = (await app.inject("/aui/agents")).json();
    const plugins: { profileDir: string; revision: string } = (await app.inject("/aui/plugins")).json();
    expect(agents.userDir).toBe(join(plugins.profileDir, "agents"));
    expect(plugins.profileDir).toBe(dir);
    // Built-in agents come from the pi-subagents copy Forgerie ships.
    expect(agents.agents.some((agent) => agent.scope === "builtin")).toBe(true);
    const create = await app.inject({ method: "PUT", url: "/aui/agents/user/new-agent", headers: { "content-type": "application/json" }, payload: JSON.stringify({ text: "---\nname: new-agent\n---\nBody", baseMtimeMs: null }) });
    expect(create.statusCode).toBe(200);
    expect(await readFile(join(dir, "agents", "new-agent.md"), "utf8")).toContain("new-agent");
    expect(await readFile(join(global, "sentinel"), "utf8")).toBe("unchanged");
    expect((await post("/aui/plugins", { revision: plugins.revision, change: { type: "toggle", id: "builtin:pi-subagents", enabled: false } })).statusCode).toBe(403);
    expect((await post("/aui/plugins", { revision: plugins.revision, change: { type: "add", source: "npm:test" } }, { origin: "https://other.example" })).statusCode).toBe(403);
    expect((await post("/aui/plugins/restart", { revision: plugins.revision, confirm: false })).statusCode).toBe(400);
    expect(restarts).toEqual([]);
    expect((await post("/aui/plugins", { revision: "stale", change: { type: "add", source: "/missing" } })).statusCode).toBe(409);
    expect((await post("/aui/plugins", { change: { type: "settings", id: "forgerie:quota", settings: [] } })).statusCode).toBe(400);
    expect((await post("/aui/plugins", "a".repeat(100_001))).statusCode).toBe(413);
  });

  it("lists, edits, and deletes the top-level agent files in ~/.agents, and never reaches below it", async () => {
    const { app, home } = await settingsServer();
    await writeFile(join(home, "researcher.md"), "---\nname: researcher\ndescription: Reads sources\n---\nRead.");
    await mkdir(join(home, "skills", "research"), { recursive: true });
    await writeFile(join(home, "skills", "research", "SKILL.md"), "---\nname: research\n---\nNot an agent.");
    const list: { homeDir: string; agents: { scope: string; file: string; description: string }[] } = (await app.inject("/aui/agents")).json();
    expect(list.homeDir).toBe(home);
    expect(list.agents.filter((agent) => agent.scope === "home")).toEqual([expect.objectContaining({ file: "researcher", description: "Reads sources" })]);
    const read: { text: string; mtimeMs: number } = (await app.inject("/aui/agents/home/researcher")).json();
    expect(read.text).toContain("Read.");
    const put = (url: string, body: unknown) => app.inject({ method: "PUT", url, headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    const saved = await put("/aui/agents/home/researcher", { text: "---\nname: researcher\n---\nRead more.", baseMtimeMs: read.mtimeMs });
    expect(saved.statusCode).toBe(200);
    expect(await readFile(join(home, "researcher.md"), "utf8")).toContain("Read more.");
    expect((await app.inject("/aui/agents/home/skills%2Fresearch%2FSKILL")).statusCode).toBe(400);
    expect((await put("/aui/agents/home/skills%2Fnew", { text: "x", baseMtimeMs: null })).statusCode).toBe(400);
    const { mtimeMs }: { mtimeMs: number } = saved.json();
    expect((await app.inject({ method: "DELETE", url: `/aui/agents/home/researcher?baseMtimeMs=${String(mtimeMs)}` })).statusCode).toBe(200);
    expect(await readFile(join(home, "skills", "research", "SKILL.md"), "utf8")).toContain("Not an agent.");
  });

  it("tells the browser app which bundled plugins are on, with every setting resolved", async () => {
    const { app, post } = await settingsServer();
    const states: { plugins: { id: string; enabled: boolean; settings: Record<string, unknown> }[] } = (await app.inject("/aui/app-plugins")).json();
    expect(states.plugins.map((plugin) => [plugin.id, plugin.enabled])).toEqual([["cliproxyapi-quota", true]]);
    expect(states.plugins[0]?.settings["seven_day"]).toBe(true);
    expect((await post("/aui/app-plugins", {})).statusCode).toBe(405);
  });

  it("reads, writes, and deletes one agent file only from the version the reader saw", async () => {
    const { app, dir } = await settingsServer();
    await writeFile(join(dir, "agents", "scout.md"), "---\nname: scout\ndescription: |\n  Finds things\n  fast\nfallbackModels: a, b\n---\nLook.");
    const put = (url: string, body: unknown) => app.inject({ method: "PUT", url, headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    const list: { agents: { scope: string; file: string; description: string; broken?: string }[] } = (await app.inject("/aui/agents")).json();
    expect(list.agents.find((agent) => agent.scope === "user" && agent.file === "scout")).toMatchObject({ description: "Finds things\nfast", broken: "Lists fallbacks, so sessions cannot use it" });
    const read: { text: string; mtimeMs: number } = (await app.inject("/aui/agents/user/scout")).json();
    expect(read.text).toContain("Look.");
    expect((await app.inject("/aui/agents/user/missing")).statusCode).toBe(404);
    expect((await app.inject("/aui/agents/elsewhere/scout")).statusCode).toBe(404);
    expect((await app.inject("/aui/agents/user/..%2Fescape")).statusCode).toBe(400);
    expect((await put("/aui/agents/user/scout", { text: "new", baseMtimeMs: read.mtimeMs - 1 })).statusCode).toBe(409);
    expect((await put("/aui/agents/user/scout", { text: "new", baseMtimeMs: null })).statusCode).toBe(409);
    expect((await put("/aui/agents/user/scout", { baseMtimeMs: read.mtimeMs })).statusCode).toBe(400);
    expect((await put("/aui/agents/builtin/scout", { text: "new", baseMtimeMs: null })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/aui/agents" })).statusCode).toBe(405);
    const saved = await put("/aui/agents/user/scout", { text: "saved", baseMtimeMs: read.mtimeMs });
    expect(saved.statusCode).toBe(200);
    const { mtimeMs } = saved.json<{ mtimeMs: number }>();
    expect((await app.inject({ method: "DELETE", url: `/aui/agents/user/scout?baseMtimeMs=${String(read.mtimeMs)}` })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: `/aui/agents/user/scout?baseMtimeMs=${String(mtimeMs)}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/aui/agents/user/scout?baseMtimeMs=${String(mtimeMs)}` })).statusCode).toBe(404);
  });

  it("serves the model lists from the daemon profile", async () => {
    const { app, dir } = await settingsServer();
    const prefs = await app.inject("/aui/model-prefs");
    expect(prefs.statusCode).toBe(200);
    expect(prefs.json()).toMatchObject({ favorites: ["proxy/a"], favoritesPath: join(dir, "settings.json") });
  });

  it("answers an unknown settings path with 404, and a settings read without sessiond with an error", async () => {
    expect((await (await settingsServer()).app.inject("/aui/nothing")).statusCode).toBe(404);
    const down = await (await settingsServer({ available: false })).app.inject("/aui/model-prefs");
    expect(down.statusCode).toBe(500);
    expect(down.body).toContain("session daemon is unavailable");
  });
});
