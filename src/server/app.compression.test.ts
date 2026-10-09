import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { appTestContext, registerAppTestHooks } from "./app.testSupport.js";

registerAppTestHooks();

describe("browser-facing HTTP compression", () => {
  it("negotiates compression for large local API responses", async () => {
    const marker = "local transcript content ".repeat(256);
    appTestContext.piWebConfig = {
      plugins: { fake: { settings: { marker } } },
    };

    const compressed = await appTestContext.app.inject({
      method: "GET",
      url: "/api/config",
      headers: { "accept-encoding": "gzip" },
    });
    const identity = await appTestContext.app.inject({
      method: "GET",
      url: "/api/config",
      headers: { "accept-encoding": "identity" },
    });

    expect(compressed.statusCode).toBe(200);
    expect(compressed.headers["content-encoding"]).toBe("gzip");
    expect(compressed.headers["content-length"]).toBeUndefined();
    expect(compressed.headers.vary).toContain("accept-encoding");
    expect(gunzipJson(compressed)).toMatchObject({ effectiveConfig: { plugins: { fake: { settings: { marker } } } } });

    expect(identity.statusCode).toBe(200);
    expect(identity.headers["content-encoding"]).toBeUndefined();
    expect(identity.json()).toMatchObject({ effectiveConfig: { plugins: { fake: { settings: { marker } } } } });
  });
});

function gunzipJson(response: { rawPayload: Buffer }): unknown {
  const value: unknown = JSON.parse(gunzipSync(response.rawPayload).toString("utf8"));
  return value;
}
