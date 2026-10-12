import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { PI_WEB_CAPABILITIES } from "@shared/capabilities";
import { deliverPrompt, promptDelivery } from "./promptDelivery";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function server(runtime: unknown, runtimeStatus = 200) {
  const prompts: { body: string; at: number }[] = [];
  const http = createServer(async (request, response) => {
    if (request.url === "/api/sessiond/runtime") {
      response.writeHead(runtimeStatus, { "Content-Type": "application/json" });
      response.end(JSON.stringify(runtime));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    prompts.push({ body: Buffer.concat(chunks).toString(), at: Date.now() });
    response.writeHead(prompts.length === 1 ? 502 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(prompts.length === 1 ? { error: "daemon socket failed" } : { accepted: true }));
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const transport = (path: string, init: RequestInit) => fetch(`http://127.0.0.1:${address.port}${path}`, init);
  cleanup.push(async () => { http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); });
  return { transport, prompts };
}
const advertised = { component: "sessiond", label: "Session daemon", available: true, capabilities: [PI_WEB_CAPABILITIES.promptRequestIds] };

describe("capability-gated prompt retries", () => {
  it("waits before retrying a proxy 502 and retains its exact delivery body", async () => {
    const api = await server(advertised);
    const response = await deliverPrompt(api.transport, "/api/sessions/one/prompt", promptDelivery({ text: "once" }));
    expect(response.status).toBe(200);
    expect(api.prompts).toHaveLength(2);
    expect(api.prompts[1]!.body).toBe(api.prompts[0]!.body);
    expect(api.prompts[1]!.at - api.prompts[0]!.at).toBeGreaterThanOrEqual(100);
  });

  it.each([
    { runtime: { ...advertised, capabilities: [] }, status: 200 },
    { runtime: { ...advertised, available: false }, status: 200 },
    { runtime: { capabilities: advertised.capabilities }, status: 200 },
    { runtime: advertised, status: 502 },
  ])("preserves the send failure without retrying unconfirmed support: %j", async ({ runtime, status }) => {
    const api = await server(runtime, status);
    const response = await deliverPrompt(api.transport, "/api/sessions/one/prompt", promptDelivery({ text: "once" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "daemon socket failed" });
    expect(api.prompts).toHaveLength(1);
  });
});
