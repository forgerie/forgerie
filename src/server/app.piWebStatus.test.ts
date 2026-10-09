import { describe, expect, it } from "vitest";
import type { PiWebRuntimeResponse, PiWebVersionResponse } from "../shared/apiTypes.js";
import { appTestContext, registerAppTestHooks } from "./app.testSupport.js";

registerAppTestHooks();

describe("local diagnostic routes", () => {
  it.each(["/api/pi-web/status", "/api/pi-web/version"])("returns local versions through %s even when daemon runtime data is invalid", async (url) => {
    appTestContext.agentProfileResult = { status: "invalid", error: "Unavailable daemon" };
    const response = await appTestContext.app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(200);
    const body = response.json<PiWebVersionResponse>();
    expect(body.packageName).toBe("forgerie");
    expect(body.components.web).toMatchObject({ available: true, stale: false });
    expect(body.components.sessiond).toMatchObject({ available: false, stale: false });
    expect(body).not.toHaveProperty("latestVersion");
    expect(appTestContext.sessionDaemonRequests).toEqual([{ method: "GET", path: "/runtime" }]);
  });

  it("keeps runtime capability discovery available", async () => {
    appTestContext.agentProfileResult = { status: "invalid", error: "Unavailable daemon" };
    const response = await appTestContext.app.inject({ method: "GET", url: "/api/pi-web/runtime" });
    expect(response.statusCode).toBe(200);
    expect(response.json<PiWebRuntimeResponse>()).toMatchObject({ packageName: "forgerie", components: { web: { available: true }, sessiond: { available: false } } });
  });
});
