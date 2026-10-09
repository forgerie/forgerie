import { describe, expect, it } from "vitest";
import { appTestContext, registerAppTestHooks } from "./app.testSupport.js";

const retiredRoutes = [
  "/api/machines", "/api/machines/remote/projects", "/api/machines/local/config", "/api/machines/local/plugins",
  "/api/plugins", "/pi-web-plugins/manifest.json", "/pi-web-plugins/info/pi-web-plugin.js",
  "/api/auth/providers", "/api/machines/local/auth/providers", "/api/terminals", "/api/terminal-command-runs",
];

describe.each([false, true])("retired routes with SPA serving %s", (clientDist) => {
  registerAppTestHooks({ clientDist });
  it.each(retiredRoutes)("returns a real 404 for %s without contacting sessiond", async (url) => {
    const response = await appTestContext.app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(appTestContext.sessionDaemonRequests).toEqual([]);
  });
  it.each(["/api/auth/login", "/api/speech/check-turn", "/api/terminal-command-runs"])("refuses retired mutations through %s", async (url) => {
    const response = await appTestContext.app.inject({ method: "POST", url, payload: {} });
    expect(response.statusCode).toBe(404);
    expect(appTestContext.sessionDaemonRequests).toEqual([]);
  });
  it("keeps browser navigation separate from API fallback", async () => {
    const response = await appTestContext.app.inject({ method: "GET", url: "/settings/plugins" });
    expect(response.statusCode).toBe(clientDist ? 200 : 404);
    if (clientDist) expect(response.body).toContain("Forgerie test shell");
  });
});
