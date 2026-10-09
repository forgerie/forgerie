import { afterEach, describe, expect, it, vi } from "vitest";
import { activeForgerieProfile, agentsInProfile, type Gateway } from "./forgerieProfile.js";

const gateway = (dir = "/forgerie/agent", available = true): Gateway => (path) => Promise.resolve(path === "/api/config"
  ? { path: "/forgerie/config.json", config: { agent: { dir: "/future/profile" } } }
  : { components: { sessiond: { available, activeAgentProfile: { dir, command: "pi", revision: "active" } } } });
afterEach(() => vi.unstubAllEnvs());
describe("settings profile", () => {
  it("uses sessiond's active profile, not a stale Pi environment or a future config", async () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", "/global/pi");
    const profile = await activeForgerieProfile(gateway());
    expect(profile.dir).toBe("/forgerie/agent");
    expect(agentsInProfile(profile)).toBe("/forgerie/agent/agents");
  });
  it("fails closed when sessiond is unavailable instead of falling back to global Pi", async () => {
    await expect(activeForgerieProfile(gateway("/forgerie/agent", false))).rejects.toThrow("session daemon is unavailable");
  });
  it("refuses relative paths from the gateway", async () => {
    await expect(activeForgerieProfile(gateway("../global/pi"))).rejects.toThrow("absolute settings paths");
  });
});
