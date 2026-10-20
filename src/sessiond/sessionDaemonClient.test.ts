import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionDaemonClient } from "./sessionDaemonClient.js";

afterEach(() => vi.unstubAllEnvs());

const activeAgentProfile = {
  schemaVersion: 1,
  revision: `sha256:${"a".repeat(64)}`,
  command: "acme-agent",
  dir: "/opt/acme-agent/state",
  sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR"],
};

describe("SessionDaemonClient active agent profile protocol", () => {
  it("returns the validated immutable profile from the daemon runtime endpoint", async () => {
    const client = new SessionDaemonClient();
    const request = vi.spyOn(client, "request").mockResolvedValue(runtimeResponse(activeAgentProfile));

    const result = await client.getActiveAgentProfile();

    expect(request).toHaveBeenCalledWith("GET", "/runtime");
    expect(result).toEqual({ status: "available", profile: activeAgentProfile });
    if (result.status === "available") {
      expect(Object.isFrozen(result.profile)).toBe(true);
      expect(Object.isFrozen(result.profile.sessionDirEnvKeys)).toBe(true);
    }
  });

  it("distinguishes invalid protocol responses from daemon unavailability", async () => {
    const invalidClient = new SessionDaemonClient();
    vi.spyOn(invalidClient, "request").mockResolvedValue(runtimeResponse({
      ...activeAgentProfile,
      token: "must-not-cross-the-protocol",
    }));
    const unavailableClient = new SessionDaemonClient();
    vi.spyOn(unavailableClient, "request").mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(invalidClient.getActiveAgentProfile()).resolves.toEqual({
      status: "invalid",
      error: "session daemon runtime response was invalid",
    });
    await expect(unavailableClient.getActiveAgentProfile()).resolves.toEqual({
      status: "unavailable",
      error: "connect ECONNREFUSED",
    });
  });

  it.skipIf(process.platform === "win32")("rejects foreign-platform active state paths before local consumers use them", async () => {
    const client = new SessionDaemonClient();
    vi.spyOn(client, "request").mockResolvedValue(runtimeResponse({
      ...activeAgentProfile,
      dir: "C:\\agent-profiles\\acme",
    }));

    await expect(client.getActiveAgentProfile()).resolves.toEqual({
      status: "invalid",
      error: "session daemon active agent profile was not valid for this host",
    });
  });

  it("treats a legacy runtime response without a profile as invalid for profile-dependent work", async () => {
    const client = new SessionDaemonClient();
    vi.spyOn(client, "request").mockResolvedValue(runtimeResponse(undefined));

    await expect(client.getActiveAgentProfile()).resolves.toEqual({
      status: "invalid",
      error: "session daemon runtime response did not include an active agent profile",
    });
  });
});

describe("bounded diagnostic requests", () => {
  it.skipIf(process.platform === "win32").each(["http", "socket"] as const)("cancels a stalled %s response without changing normal requests", async (transport) => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-daemon-deadline-"));
    const socketPath = join(dir, "daemon.sock");
    const server = createServer((request, response) => {
      if (request.url === "/ready") { response.writeHead(200); response.end("ready"); }
      else if (request.url === "/streaming") { response.writeHead(200); response.write("partial body"); }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        if (transport === "http") server.listen(0, "127.0.0.1", resolve);
        else server.listen(socketPath, resolve);
      });
      if (transport === "http") {
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("Expected an HTTP listen address");
        vi.stubEnv("PI_WEB_SESSIOND_URL", `http://127.0.0.1:${String(address.port)}`);
      } else {
        vi.stubEnv("PI_WEB_SESSIOND_URL", "");
        vi.stubEnv("PI_WEB_SESSIOND_SOCKET", socketPath);
      }
      expect((await new SessionDaemonClient().request("GET", "/ready")).body).toBe("ready");
      await expect(new SessionDaemonClient({ requestTimeoutMs: 100 }).request("GET", "/stalled")).rejects.toThrow(/abort|timeout/i);
      await expect(new SessionDaemonClient({ requestTimeoutMs: 100 }).request("GET", "/streaming")).rejects.toThrow(/abort|timeout/i);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("opt-in measurement trace header", () => {
  it.skipIf(process.platform === "win32").each(["http", "socket"] as const)("forwards only a validated trace identity over %s", async (transport) => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-daemon-trace-"));
    const socketPath = join(dir, "daemon.sock");
    const seen: (string | string[] | undefined)[] = [];
    const server = createServer((request, response) => {
      seen.push(request.headers["x-forgerie-trace"]);
      request.resume();
      request.on("end", () => { response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        if (transport === "http") server.listen(0, "127.0.0.1", resolve);
        else server.listen(socketPath, resolve);
      });
      if (transport === "http") {
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("Expected an HTTP listen address");
        vi.stubEnv("PI_WEB_SESSIOND_URL", `http://127.0.0.1:${String(address.port)}`);
      } else {
        vi.stubEnv("PI_WEB_SESSIOND_URL", "");
        vi.stubEnv("PI_WEB_SESSIOND_SOCKET", socketPath);
      }
      const client = new SessionDaemonClient();
      const trace = "0123456789abcdef0123456789abcdef";
      await client.request("GET", "/plain");
      await client.request("GET", "/traced", undefined, undefined, { traceId: trace });
      await client.request("POST", "/traced-body", { cwd: "/repo" }, undefined, { traceId: trace });
      await client.request("GET", "/malformed", undefined, undefined, { traceId: "not-a-trace\r\nx-injected: 1" });
      expect(seen).toEqual([undefined, trace, trace, undefined]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function runtimeResponse(profile: unknown) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      component: "sessiond",
      label: "Session daemon",
      available: true,
      capabilities: [],
      ...(profile === undefined ? {} : { activeAgentProfile: profile }),
    }),
  };
}
