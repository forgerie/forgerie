import { describe, expect, it } from "vitest";
import { nativeFixtureOptions, fixtureEnvironment } from "./stack-latency-native-options.mjs";

describe("isolated native fixture boundary", () => {
  it("requires a fresh absolute scratch root and an explicit client build", () => {
    expect(() => nativeFixtureOptions([])).toThrow();
    expect(() => nativeFixtureOptions(["/home/live", "18646", "/tmp/client"])).toThrow();
    expect(() => nativeFixtureOptions(["/tmp/fg-test", "8504", "/tmp/client"])).toThrow();
    expect(nativeFixtureOptions(["/tmp/fg-test", "18642", "/tmp/client"])).toMatchObject({ root: "/tmp/fg-test", port: 18642, clientDist: "/tmp/client" });
  });
  it("does not inherit credentials, live configuration, or home", () => {
    const env = fixtureEnvironment("/tmp/fg-test", { PATH: "/bin", HOME: "/live", OPENAI_API_KEY: "secret", PI_WEB_SESSIOND_URL: "http://live", NODE_OPTIONS: "injected" });
    expect(env.HOME).toBe("/tmp/fg-test");
    expect(env.PATH).toBe("/bin");
    expect(env.PI_WEB_SESSIOND_SOCKET).toBe("/tmp/fg-test/sessiond.sock");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.PI_WEB_SESSIOND_URL).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
  });
});
