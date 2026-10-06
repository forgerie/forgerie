import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore, type SessionTransport } from "./sessionStore";
import type { OperationEvent, SessionStatus } from "./contracts";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const opus = { provider: "cliproxyapi", id: "claude-opus-5-5", name: "Claude Opus 5.5", reasoning: true, scoped: true };
const codex = { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", reasoning: false };
const initial: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [], model: opus, thinkingLevel: "high" };
async function until(predicate: () => boolean) { await expect.poll(predicate, { timeout: 2000 }).toBe(true); }

/** A Forgerie session API whose model and thinking level change like Pi's. */
async function runtimeServer() {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const state = { status: initial, seq: 0, failNext: undefined as undefined | "error" | "drop" | "gateway" };
  const ws = new WebSocketServer({ noServer: true });
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push({ method: request.method ?? "GET", path: url.pathname, body });
    const send = (data: unknown, code = 200) => { response.writeHead(code, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
    const mutation = request.method === "POST";
    if (mutation && state.failNext === "drop") { state.failNext = undefined; response.destroy(); return; }
    if (mutation && state.failNext === "error") { state.failNext = undefined; send({ error: "Model not found: x/y" }, 400); return; }
    if (mutation && state.failNext === "gateway") { state.failNext = undefined; send({ error: "Bad gateway" }, 502); return; }
    if (url.pathname.endsWith("/messages")) send({ messages: [], start: 0, total: 0 });
    else if (url.pathname.endsWith("/stream-snapshot")) send({ seq: state.seq, partial: null });
    else if (url.pathname.endsWith("/status")) send(state.status);
    else if (url.pathname.endsWith("/commands")) send([]);
    else if (url.pathname.endsWith("/models")) send({ models: [opus, codex] });
    else if (url.pathname.endsWith("/thinking-levels")) send({ levels: state.status.model?.reasoning === false ? ["off"] : ["off", "low", "medium", "high"] });
    else if (url.pathname.endsWith("/model")) {
      const { provider, modelId } = body as { provider: string; modelId: string };
      const model = [opus, codex].find((item) => item.provider === provider && item.id === modelId)!;
      state.status = { ...state.status, model, thinkingLevel: model.reasoning ? state.status.thinkingLevel : "off" };
      send(state.status);
    } else if (url.pathname.endsWith("/thinking-level")) {
      state.status = { ...state.status, thinkingLevel: (body as { level: string }).level };
      send(state.status);
    } else send({ error: "Unexpected endpoint" }, 404);
  });
  http.on("upgrade", (request, socket, head) => ws.handleUpgrade(request, socket, head, () => {}));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const origin = `http://127.0.0.1:${address.port}`;
  const transport: SessionTransport = {
    request: (path, init) => fetch(origin + path, init), connect: (path) => new WebSocket(origin.replace("http:", "ws:") + path),
  };
  cleanup.push(async () => {
    for (const socket of ws.clients) socket.terminate();
    ws.close(); http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  const store = createSessionStore("test", transport, { retryDelayMs: 10 }, { id: "test", cwd: "/work tree" });
  cleanup.push(store.dispose);
  const emit = (event: OperationEvent) => {
    if (event.type === "status.update") state.status = event.status;
    for (const socket of ws.clients) socket.send(JSON.stringify({ ...event, seq: ++state.seq }));
  };
  const mutations = () => requests.filter(({ method }) => method === "POST").map(({ path, body }) => ({ path: path.replace("/api/sessions/test/", ""), body }));
  await store.start();
  return { state, store, emit, mutations };
}

describe("model and thinking level", () => {
  it("reads the active model and thinking level from status, and follows live updates", async () => {
    const api = await runtimeServer();
    expect(api.store.getSnapshot().status?.model?.id).toBe("claude-opus-5-5");
    expect(api.store.getSnapshot().status?.thinkingLevel).toBe("high");
    api.emit({ type: "status.update", status: { ...initial, model: codex, thinkingLevel: "off" } });
    await until(() => api.store.getSnapshot().status?.model?.id === "gpt-5.6-sol");
    expect(api.store.getSnapshot().status?.thinkingLevel).toBe("off");
  });

  it("lists the session's models and the levels its current model allows", async () => {
    const api = await runtimeServer();
    const models = await api.store.listModels();
    expect(models.map((model) => model.id)).toEqual(["claude-opus-5-5", "gpt-5.6-sol"]);
    expect(await api.store.listThinkingLevels()).toEqual(["off", "low", "medium", "high"]);
  });

  it("changes the model and the thinking level through Pi, and shows the status Pi returns", async () => {
    const api = await runtimeServer();
    await api.store.setModel("openai-codex", "gpt-5.6-sol");
    expect(api.store.getSnapshot().status?.model?.id).toBe("gpt-5.6-sol");
    expect(api.store.getSnapshot().status?.thinkingLevel).toBe("off");
    await api.store.setThinkingLevel("low");
    expect(api.store.getSnapshot().status?.thinkingLevel).toBe("low");
    expect(api.mutations()).toEqual([
      { path: "model", body: { cwd: "/work tree", provider: "openai-codex", modelId: "gpt-5.6-sol" } },
      { path: "thinking-level", body: { cwd: "/work tree", level: "low" } },
    ]);
  });

  it("reports Pi's refusal and keeps the old choice", async () => {
    const api = await runtimeServer();
    api.state.failNext = "error";
    await expect(api.store.setModel("openai-codex", "gpt-5.6-sol")).rejects.toThrow("Model not found: x/y");
    expect(api.store.getSnapshot().status?.model?.id).toBe("claude-opus-5-5");
  });

  it("does not call a gateway error a refusal, because the change may have applied", async () => {
    const api = await runtimeServer();
    api.state.failNext = "gateway";
    await expect(api.store.setModel("openai-codex", "gpt-5.6-sol")).rejects.toThrow(/Bad gateway.*may have changed/);
  });

  it("never retries a change whose acknowledgement was lost, and says it may have applied", async () => {
    const api = await runtimeServer();
    api.state.failNext = "drop";
    await expect(api.store.setThinkingLevel("low")).rejects.toThrow(/may have changed/);
    expect(api.mutations()).toHaveLength(1);
  });
});
