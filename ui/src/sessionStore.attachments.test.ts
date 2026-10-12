import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore, type SessionTransport } from "./sessionStore";
import { createAttachmentAdapter, promptOf } from "./attachments";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function server({ uploadError = false, promptError = false, malformed = false } = {}) {
  const requests: { path: string; body: unknown }[] = [];
  const sockets = new WebSocketServer({ noServer: true });
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "POST") requests.push({ path, body });
    const send = (value: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
    if (path.endsWith("/messages")) send({ messages: [], start: 0, total: 0 });
    else if (path.endsWith("/stream-snapshot")) send({ partial: null, seq: 0 });
    else if (path.endsWith("/status")) send({ isStreaming: false, isCompacting: false, isBashRunning: false });
    else if (path.endsWith("/attachments")) {
      if (uploadError) send({ error: "Disk full" }, 400);
      else send({ attachments: malformed ? [] : [{ path: ".forgerie/attachments/notes.txt", mimeType: "text/plain", size: 5 }] });
    } else if (path.endsWith("/prompt")) {
      if (promptError) send({ error: "Model unavailable" }, 400);
      else send({ accepted: true });
    }
    else send({ error: "not found" }, 404);
  });
  http.on("upgrade", (request, socket, head) => sockets.handleUpgrade(request, socket, head, () => {}));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address(); if (!address || typeof address === "string") throw new Error("No port");
  const origin = `http://127.0.0.1:${address.port}`;
  const transport: SessionTransport = { request: (path, init) => fetch(origin + path, init), connect: (path) => new WebSocket(origin.replace("http:", "ws:") + path) };
  cleanup.push(async () => { for (const socket of sockets.clients) socket.terminate(); sockets.close(); await new Promise<void>((resolve) => http.close(() => resolve())); });
  const store = createSessionStore("session", transport, {}, { id: "session", cwd: "/workspace with spaces" });
  cleanup.push(store.dispose); await store.start();
  return { requests, store };
}

describe("attachment upload and prompt API binding", () => {
  it("uploads a file with cwd, then prompts with its saved path", async () => {
    const { store, requests } = await server();
    const adapter = createAttachmentAdapter(store.saveAttachment);
    const pending = adapter.add({ file: new File(["notes"], "notes.txt", { type: "text/plain" }) });
    if (!(pending instanceof Promise)) throw new Error("Expected promise");
    const complete = await adapter.send(await pending);
    const prompt = promptOf({ content: [{ type: "text", text: "Read this" }], attachments: [complete] });
    await store.send(prompt.text, prompt.attachments);
    expect(requests).toEqual([
      { path: "/api/sessions/session/attachments", body: { cwd: "/workspace with spaces", attachments: [{ kind: "file", name: "notes.txt", mimeType: "text/plain", data: "bm90ZXM=" }] } },
      { path: "/api/sessions/session/prompt", body: { cwd: "/workspace with spaces", requestId: expect.any(String), text: "Read this\n@.forgerie/attachments/notes.txt" } },
    ]);
  });
  it("passes an image-only prompt inline without an upload", async () => {
    const { store, requests } = await server();
    const attachment = { kind: "image" as const, mimeType: "image/png", data: "aGk=", name: "image.png" };
    await store.send("", [attachment]);
    expect(requests).toEqual([{ path: "/api/sessions/session/prompt", body: { cwd: "/workspace with spaces", requestId: expect.any(String), text: "", attachments: [attachment] } }]);
  });
  it("does not prompt or retry after an upload refusal", async () => {
    const { store, requests } = await server({ uploadError: true });
    await expect(store.saveAttachment({ kind: "file", mimeType: "text/plain", data: "" })).rejects.toThrow("Disk full");
    expect(requests).toHaveLength(1);
  });
  it("does not retry a rejected prompt or rewrite the uploaded file", async () => {
    const { store, requests } = await server({ promptError: true });
    const saved = await store.saveAttachment({ kind: "file", mimeType: "text/plain", data: "" });
    await expect(store.send(`@${saved.path}`)).rejects.toThrow("Model unavailable");
    expect(requests).toHaveLength(2);
    expect(store.getSnapshot().commandError).toBe("Model unavailable");
  });
  it("rejects malformed successful uploads and uploads after disposal", async () => {
    const { store, requests } = await server({ malformed: true });
    await expect(store.saveAttachment({ kind: "file", mimeType: "text/plain", data: "" })).rejects.toThrow();
    store.dispose();
    await expect(store.saveAttachment({ kind: "file", mimeType: "text/plain", data: "" })).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
});
