import { describe, expect, it } from "vitest";
import { createRuntimeApi, gatewayKeyView } from "./pluginsApi";

const secret = "DISTINCTIVE-transport-key-October15";
describe("write-only gateway settings client", () => {
  it("posts the key only in the private mutation body and sends no key when clearing", async () => {
    const requests: { path: string; init: RequestInit | undefined }[] = [];
    const api = createRuntimeApi(async (path, init) => {
      requests.push({ path: String(path), init });
      return Response.json({ keyPresent: true, source: "settings", apiKey: secret });
    });
    expect(await api.setGatewayKey("revision", secret)).toEqual({ keyPresent: true, source: "settings" });
    expect(requests[0]).toEqual({ path: "/aui/plugins/decision-hints/gateway-key", init: {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: "revision", apiKey: secret }),
    } });
    await api.clearGatewayKey("revision");
    expect(requests[1]).toEqual({ path: "/aui/plugins/decision-hints/gateway-key/clear", init: {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: "revision" }),
    } });
  });
  it("contains errors that quote a rejected key and malformed success payloads", async () => {
    const api = createRuntimeApi(async () => Response.json({ error: secret }, { status: 409 }));
    await expect(api.setGatewayKey("revision", secret)).rejects.toThrow("Could not change the gateway key");
    try { await api.setGatewayKey("revision", secret); } catch (error) { expect(String(error)).not.toContain(secret); }
    const invalid = createRuntimeApi(async () => Response.json({ [secret]: secret }));
    await expect(invalid.clearGatewayKey("revision")).rejects.toThrow("Could not change the gateway key");
  });
  it("does not expose network or JSON parser diagnostics containing the submitted key", async () => {
    const network = createRuntimeApi(async () => { throw new Error(secret); });
    const invalidJson = createRuntimeApi(async () => new Response(secret));
    for (const api of [network, invalidJson]) {
      try { await api.setGatewayKey("revision", secret); throw new Error("Expected refusal"); }
      catch (error) { expect(String(error)).toContain("Could not change the gateway key"); expect(String(error)).not.toContain(secret); }
    }
  });
  it("never permits editing unknown or environment-owned credentials", () => {
    expect(gatewayKeyView("unknown")).toMatchObject({ editable: false, value: "Unknown" });
    expect(gatewayKeyView({ keyPresent: true, source: "environment" })).toMatchObject({ editable: false, present: true, value: "Set by DECISION_GATEWAY_API_KEY" });
    expect(gatewayKeyView({ keyPresent: true, source: "settings" })).toMatchObject({ editable: true, present: true, value: "Set here" });
  });
});
