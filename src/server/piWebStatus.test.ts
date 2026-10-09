import { describe, expect, it, vi } from "vitest";
import { getPiWebRuntime, getPiWebRuntimeComponent, getPiWebVersionStatus } from "./piWebStatus.js";

function daemonResponse(statusCode: number, body: unknown) {
  return { request: vi.fn(() => Promise.resolve({ statusCode, body: JSON.stringify(body) })) };
}

const sessiond = { component: "sessiond", label: "Session daemon", runtimeVersion: "older-build", available: true, capabilities: [] };

describe("local runtime diagnostics", () => {
  it("reports the web process version and the daemon runtime without release discovery", async () => {
    const daemon = daemonResponse(200, sessiond);
    const result = await getPiWebRuntime(daemon);
    expect(result.packageName).toBe("forgerie");
    expect(result.components.web).toMatchObject({ component: "web", available: true });
    expect(result.components.web.runtimeVersion).toMatch(/^\d/);
    expect(result.components.sessiond).toEqual(sessiond);
    expect(daemon.request.mock.calls).toEqual([["GET", "/runtime"]]);
  });

  it("compares running versions with the local installed version", async () => {
    const result = await getPiWebVersionStatus(daemonResponse(200, sessiond));
    expect(result.components.web.stale).toBe(false);
    expect(result.components.web.runtimeVersion).toBe(result.components.web.installedVersion);
    expect(result.components.sessiond.stale).toBe(true);
    expect(result).not.toHaveProperty("latestVersion");
    expect(result.components.web).not.toHaveProperty("installation");
  });

  it.each([
    { statusCode: 503, body: {}, message: "HTTP 503" },
    { statusCode: 200, body: { ...sessiond, component: "web" }, message: "invalid runtime information" },
    { statusCode: 200, body: { ...sessiond, capabilities: [42] }, message: "invalid runtime information" },
  ])("reports an unavailable daemon for rejected runtime data", async ({ statusCode, body, message }) => {
    const result = await getPiWebVersionStatus(daemonResponse(statusCode, body));
    expect(result.components.web.available).toBe(true);
    expect(result.components.sessiond).toMatchObject({ available: false, stale: false });
    expect(result.components.sessiond.error).toContain(message);
  });

  it("preserves connection errors without claiming the web process is unavailable", async () => {
    const result = await getPiWebRuntime({ request: () => Promise.reject(new Error("socket unavailable")) });
    expect(result.components.sessiond).toMatchObject({ available: false, capabilities: [], error: "socket unavailable" });
    expect(result.components.web.available).toBe(true);
  });

  it("returns independent capability arrays for runtime consumers", () => {
    const first = getPiWebRuntimeComponent("web");
    const second = getPiWebRuntimeComponent("web");
    expect(first.capabilities).not.toBe(second.capabilities);
  });
});
