import { createServer, type Server, type RequestListener } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createDecisionClient, disabledDecisionClient, type DecisionRequest } from "./decisionClient.js";

const request: DecisionRequest = { model: "fast", state: "A turn reply", questions: {
  attention: { type: "choice", instructions: "Classify", criteria: { normal: "Normal", urgent: "Urgent" } },
  risk: { type: "score", instructions: "Assess risk", criteria: ["low", "high"] },
  response: { type: "noul", instructions: "Needs response?" },
} };
const answers = { model: "answering-model", answers: {
  attention: { type: "choice", choice: "urgent", probabilities: { normal: 0.1, urgent: 0.9 }, confidence: 0.9 },
  risk: { type: "score", score: 0.8, probabilities: { "0": 0.2, "1": 0.8 }, confidence: 0.8, legend: { "0": "low", "1": "high" } },
  response: { type: "noul", noul: 0.75 },
}, usage: { input_tokens: 1 } };
const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => { if (error === undefined) resolve(); else reject(error); })); } });
async function gateway(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No test gateway address");
  return `http://127.0.0.1:${String(address.port)}`;
}
const clientAt = (baseUrl: string, timeoutMs = 2000) => createDecisionClient({ readConfig: () => ({ enabled: true, baseUrl }), readApiKey: () => "test-key", timeoutMs });

describe("decision gateway client", () => {
  it("posts the contract with server-only authorization and returns the answering model", async () => {
    let received: unknown; let path: string | undefined; let authorization: string | undefined;
    const url = await gateway((req, res) => {
      path = req.url; authorization = req.headers.authorization;
      let body = ""; req.setEncoding("utf8"); req.on("data", (chunk: string) => { body += chunk; });
      req.on("end", () => { received = JSON.parse(body); res.end(JSON.stringify(answers)); });
    });
    expect(await clientAt(`${url}/`).ask(request)).toEqual({ model: answers.model, answers: answers.answers });
    expect(received).toEqual(request); expect(path).toBe("/v1/systemone"); expect(authorization).toBe("Bearer test-key");
  });
  it("times out while waiting for response headers", async () => {
    const url = await gateway(() => { /* Leave the connection open. */ });
    expect(await clientAt(url, 30).ask(request)).toBeUndefined();
  });
  it("times out while reading the body", async () => {
    const url = await gateway((_req, res) => { res.writeHead(200); res.write('{"model":'); });
    expect(await clientAt(url, 30).ask(request)).toBeUndefined();
  });
  it("returns no opinion for HTTP errors", async () => {
    const url = await gateway((_req, res) => { res.writeHead(503); res.end(JSON.stringify(answers)); });
    expect(await clientAt(url).ask(request)).toBeUndefined();
  });
  it.each(["not json", "null", "{}", JSON.stringify({ ...answers, model: 7 }), JSON.stringify({ ...answers, answers: {} }),
    JSON.stringify({ ...answers, answers: { ...answers.answers, response: { type: "noul", noul: 2 } } }),
    JSON.stringify({ ...answers, answers: { ...answers.answers, attention: { ...answers.answers.attention, choice: "invented" } } }),
    JSON.stringify({ ...answers, answers: { ...answers.answers, risk: { type: "noul", noul: 0.1 } } }),
  ])("returns no opinion for malformed or mismatched responses: %s", async (body) => {
    const url = await gateway((_req, res) => res.end(body));
    expect(await clientAt(url).ask(request)).toBeUndefined();
  });
  it("does not contact the gateway when off or unconfigured", async () => {
    let calls = 0;
    const transport: typeof fetch = () => { calls += 1; return Promise.reject(new Error("Must not fetch")); };
    for (const config of [{ enabled: false, baseUrl: "https://gateway.example" }, { enabled: true }, { enabled: true, baseUrl: "" }]) {
      expect(await createDecisionClient({ readConfig: () => config, fetch: transport }).ask(request)).toBeUndefined();
    }
    expect(await disabledDecisionClient.ask(request)).toBeUndefined(); expect(calls).toBe(0);
  });
  it("contains errors from configuration, invalid URLs, and the network", async () => {
    expect(await createDecisionClient({ readConfig: () => { throw new Error("Bad settings"); } }).ask(request)).toBeUndefined();
    expect(await clientAt("file:///tmp/gateway").ask(request)).toBeUndefined();
    expect(await createDecisionClient({ readConfig: () => ({ enabled: true, baseUrl: "https://gateway.example" }), fetch: () => Promise.reject(new Error("Unreachable")) }).ask(request)).toBeUndefined();
  });
  it("refuses redirects rather than sending turn text to another address", async () => {
    let forwarded = false;
    const target = await gateway((_req, res) => { forwarded = true; res.end(JSON.stringify(answers)); });
    const url = await gateway((_req, res) => { res.writeHead(307, { location: target }); res.end(); });
    expect(await clientAt(url).ask(request)).toBeUndefined(); expect(forwarded).toBe(false);
  });
});
