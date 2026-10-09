import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActiveAgentProfileDescriptor, PiWebConfigResponse, PiWebRuntimeResponse } from "../shared/apiTypes.js";
import { appTestContext, registerAppTestHooks } from "./app.testSupport.js";

registerAppTestHooks();

describe("desired and active agent profiles", () => {
  it("keeps a desired write separate from the active daemon profile until its reported epoch changes", async () => {
    const initial = activeProfile("a", "active-agent", join(appTestContext.tempDir, "initial-agent"));
    const desired = { command: "next-agent", dir: join(appTestContext.tempDir, "next-agent") };
    appTestContext.agentProfileResult = { status: "available", profile: initial };
    const response = await appTestContext.app.inject({ method: "PUT", url: "/api/config", payload: { config: { agent: desired } } });
    expect(response.statusCode).toBe(200);
    expect(response.json<PiWebConfigResponse>().config.agent).toEqual(desired);

    const runtime = await appTestContext.app.inject({ method: "GET", url: "/api/pi-web/runtime" });
    expect(runtime.json<PiWebRuntimeResponse>().components.sessiond.activeAgentProfile).toEqual(initial);

    const restarted = activeProfile("b", desired.command, desired.dir);
    appTestContext.agentProfileResult = { status: "available", profile: restarted };
    const nextRuntime = await appTestContext.app.inject({ method: "GET", url: "/api/pi-web/runtime" });
    expect(nextRuntime.json<PiWebRuntimeResponse>().components.sessiond.activeAgentProfile).toEqual(restarted);
  });
});

function activeProfile(revisionCharacter: string, command: string, dir: string): ActiveAgentProfileDescriptor {
  return { schemaVersion: 1, revision: `sha256:${revisionCharacter.repeat(64)}`, command, dir, sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR"] };
}
