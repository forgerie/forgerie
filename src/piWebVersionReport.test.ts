import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packageVersion, printPiWebVersionReport } from "./piWebVersionReport.js";

const component = (name: "web" | "sessiond") => ({ component: name, label: name === "web" ? "Web/UI" : "Session daemon", available: true, runtimeVersion: packageVersion(), installedVersion: packageVersion(), stale: false });
const healthy = { packageName: "forgerie", generatedAt: "2026-01-01T00:00:00.000Z", components: { web: component("web"), sessiond: component("sessiond") } };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("local runtime version report", () => {
  it.each([
    { name: "available components", body: healthy, expected: true, fallback: false, line: `Web/UI: ${packageVersion()}` },
    { name: "a stale web process", body: { ...healthy, components: { ...healthy.components, web: { ...component("web"), runtimeVersion: "0.0.1", stale: true } } }, expected: true, fallback: false, line: "Web/UI: 0.0.1 (restart needed)" },
    { name: "an unavailable daemon", body: { ...healthy, components: { ...healthy.components, sessiond: { component: "sessiond", label: "Session daemon", available: false, stale: false, error: "Daemon stopped" } } }, expected: false, fallback: false, line: "Session daemon: unavailable" },
    { name: "an invalid web response", body: {}, expected: false, fallback: true, line: `Session daemon: ${packageVersion()}` },
  ])("reports $name without registry access or service writes", async ({ body, expected, fallback, line }) => {
    const requests: string[] = [];
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? ""} ${request.url ?? ""}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.url === "/health" ? { version: component("sessiond") } : body));
    });
    const dir = await mkdtemp(join(tmpdir(), "forgerie-version-report-"));
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Expected HTTP server address");
      const config = join(dir, "config.json");
      await writeFile(config, JSON.stringify({ host: "127.0.0.1", port: address.port }));
      vi.stubEnv("PI_WEB_CONFIG", config);
      vi.stubEnv("PI_WEB_SESSIOND_URL", `http://127.0.0.1:${String(address.port)}`);
      expect(await printPiWebVersionReport()).toBe(expected);
      expect(requests).toEqual(fallback ? ["GET /api/pi-web/version", "GET /health"] : ["GET /api/pi-web/version"]);
      expect(output).toHaveBeenCalledWith(line);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
      await rm(dir, { recursive: true, force: true });
    }
  });
});
