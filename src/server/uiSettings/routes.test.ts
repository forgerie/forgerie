import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerUiSettingsRoutes } from "./routes.js";

const apps: FastifyInstance[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A Forgerie server whose own API reports `dir` as sessiond's profile and `global` as a stale config value. */
async function settingsServer(options: { available?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "settings-http-")); roots.push(root);
  const dir = join(root, "owned-profile"); const global = join(root, "terminal-profile");
  await mkdir(join(dir, "agents"), { recursive: true }); await mkdir(global);
  await writeFile(join(global, "sentinel"), "unchanged");
  await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: [], enabledModels: ["proxy/a"] }));
  const configPath = join(root, "config.json"); await writeFile(configPath, "{}");
  const app = Fastify({ logger: false }); apps.push(app);
  app.get("/api/pi-web/runtime", () => ({ components: { sessiond: { available: options.available ?? true, activeAgentProfile: { dir, command: "pi", revision: "runtime" } } } }));
  app.get("/api/config", () => ({ path: configPath, config: { agent: { dir: global } } }));
  app.get("/api/plugins", () => ({ plugins: [] }));
  const restarts: number[] = [];
  await registerUiSettingsRoutes(app, { pluginServices: { read: () => Promise.resolve({ available: true, stamp: ["1", "1"] }), restart: () => { restarts.push(1); return Promise.resolve(); } } });
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url, headers: { "content-type": "application/json", ...headers }, payload: JSON.stringify(body) });
  return { app, dir, global, restarts, post };
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
