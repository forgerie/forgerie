import { createServer } from "vite";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { PluginService } from "./pluginService";
import { pluginFilesApi } from "./pluginFilesApi";
import { agentFilesApi } from "../agents/agentFilesApi";
import { activeForgerieProfile, type Gateway } from "../settings/forgerieProfile";

const servers: Awaited<ReturnType<typeof createServer>>[] = [];
const roots: string[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("settings HTTP routes", () => {
  it("writes Agents and Plugins to the same daemon profile and refuses unsafe plugin requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "settings-http-")); roots.push(root);
    const dir = join(root, "owned-profile"); const global = join(root, "terminal-profile");
    await mkdir(join(dir, "agents"), { recursive: true }); await mkdir(global);
    await writeFile(join(global, "sentinel"), "unchanged");
    await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: [] }));
    const configPath = join(root, "config.json"); await writeFile(configPath, "{}");
    const gateway: Gateway = async (path) => {
      if (path === "/api/pi-web/runtime") return { components: { sessiond: { available: true, activeAgentProfile: { dir, command: "pi", revision: "runtime" } } } };
      if (path === "/api/config") return { path: configPath, config: { agent: { dir: global } } };
      if (path === "/api/plugins") return { plugins: [] };
      throw new Error(`Unexpected ${path}`);
    };
    let restarts = 0;
    const service = new PluginService({ gateway, services: { read: async () => ({ available: true, stamp: ["1", "1"] }), restart: async () => { restarts += 1; } } });
    const server = await createServer({ configFile: false, root, plugins: [
      agentFilesApi(async () => ({ user: join((await activeForgerieProfile(gateway)).dir, "agents"), builtin: undefined })), pluginFilesApi(service),
    ], server: { port: 0, host: "127.0.0.1" } }); servers.push(server);
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No TCP address");
    const base = `http://127.0.0.1:${String(address.port)}`;
    const request = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    });
    const agents = await (await fetch(`${base}/aui/agents`)).json() as { userDir: string };
    const plugins = await (await fetch(`${base}/aui/plugins`)).json() as { profileDir: string; revision: string };
    expect(agents.userDir).toBe(join(plugins.profileDir, "agents"));
    const create = await fetch(`${base}/aui/agents/user/new-agent`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "---\nname: new-agent\n---\nBody", baseMtimeMs: null }) });
    expect(create.status).toBe(200);
    expect(await readFile(join(dir, "agents", "new-agent.md"), "utf8")).toContain("new-agent");
    expect(await readFile(join(global, "sentinel"), "utf8")).toBe("unchanged");
    expect((await request("/aui/plugins", { revision: plugins.revision, change: { type: "toggle", id: "builtin:pi-subagents", enabled: false } })).status).toBe(403);
    expect((await request("/aui/plugins", { revision: plugins.revision, change: { type: "add", source: "npm:test" } }, { origin: "https://other.example" })).status).toBe(403);
    expect((await request("/aui/plugins/restart", { revision: plugins.revision, confirm: false })).status).toBe(400);
    expect(restarts).toBe(0);
    expect((await request("/aui/plugins", { revision: "stale", change: { type: "add", source: "/missing" } })).status).toBe(409);
    expect((await request("/aui/plugins", { change: { type: "settings", id: "forgerie:quota", settings: [] } })).status).toBe(400);
    expect((await request("/aui/plugins", "a".repeat(100_001))).status).toBe(413);
  });
});
