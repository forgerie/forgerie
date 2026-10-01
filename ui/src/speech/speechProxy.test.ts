import { describe, expect, it } from "vitest";
import { speechProxyHeaders, speechProxyRequestHeaders } from "./speechProxy";
describe("speech proxy origin guard", () => {
  it("translates only matching browser origin and host for speech", () => {
    expect(speechProxyHeaders("/api/speech/transcribe", "localhost:8510", "http://localhost:8510", "same-origin"))
      .toEqual({ host: "127.0.0.1:8504", origin: "http://127.0.0.1:8504" });
  });
  it("handles the HTTPS HTTP/2 authority header instead of Host", () => {
    expect(speechProxyRequestHeaders("/api/speech/transcribe", {
      ":authority": "zao.hummingbird-lake.ts.net:8510", origin: "https://zao.hummingbird-lake.ts.net:8510", "sec-fetch-site": "same-origin",
    }, ["zao.hummingbird-lake.ts.net"])).toEqual({ host: "127.0.0.1:8504", origin: "http://127.0.0.1:8504" });
  });
  it("rejects same-origin attacker hosts rather than laundering them into loopback", () => {
    expect(speechProxyHeaders("/api/speech/transcribe", "attacker.example:8510", "http://attacker.example:8510", "same-origin")).toBeUndefined();
  });
  it("rejects ambiguous host or fetch metadata headers", () => {
    expect(speechProxyRequestHeaders("/api/speech/transcribe", {
      host: "evil.test", ":authority": "localhost:8510", origin: "http://localhost:8510",
    })).toBeUndefined();
    expect(speechProxyRequestHeaders("/api/speech/transcribe", {
      host: "localhost:8510", origin: "http://localhost:8510", "sec-fetch-site": ["same-origin", "cross-site"],
    })).toBeUndefined();
  });
  it.each([
    ["/api/sessions/all", "localhost:8510", "http://localhost:8510", "same-origin"],
    ["/api/speech/transcribe", "localhost:8510", "https://evil.test", "cross-site"],
    ["/api/speech/transcribe", "localhost:8510", "http://localhost:8510", "cross-site"],
    ["/api/speech/transcribe", "localhost:8510", "http://localhost:8510", "same-site"],
    ["/api/speech/transcribe", "localhost:8510", "null", undefined],
    ["/api/speech/transcribe", "localhost:8510", undefined, undefined],
  ])("preserves requests that are not trusted same-origin speech", (path, host, origin, site) => {
    expect(speechProxyHeaders(path, host, origin, site)).toBeUndefined();
  });
});
