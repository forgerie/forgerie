#!/usr/bin/env node
// Isolated fixture service through the production HTTP routes, projection,
// paging and event hub. Storage/runtime acquisition latency is NOT measured.
// Build first: npm --prefix ui run build
// Start through the managed process tool: node_modules/.bin/tsx scripts/fast-chat-open-server.mjs 18641
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { fileURLToPath } from "node:url";
import { registerSessionRoutes } from "../src/server/sessions/sessionRoutes.ts";
import { SessionEventHub } from "../src/server/realtime/sessionEventHub.ts";
import { pageMessagesAtSafeBoundary } from "../src/server/sessions/messagePaging.ts";
import { fixtures as originals, fixtureCwd } from "../ui/scripts/fixtures/fast-chat-open.mjs";
const huge = originals.find(fixture => fixture.id === "huge");
const fixtures = [...originals, ...Array.from({ length: 5 }, (_, index) => ({ ...huge, id: `huge-${index + 2}`, name: `Huge cache ${index + 2}` }))];
const port = Number(process.argv[2] ?? 18641);
const firstPage = process.argv.includes("--first-page");
const app = Fastify();
await app.register(websocket);
await app.register(staticFiles, { root: fileURLToPath(new URL("../dist/client/", import.meta.url)) });
const hub = new SessionEventHub();
const find = ref => {
  const found = fixtures.find(fixture => fixture.id === ref.id);
  if (!found || ref.cwd !== fixtureCwd) throw new Error("Fixture session not found");
  return found;
};
const idle = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const partial = { role: "assistant", content: [{ type: "text", text: "Readable streaming last turn. Working on the deterministic fixture." }], timestamp: 1791972999999 };
function open(ref, page) {
  const fixture = find(ref);
  const messages = fixture.messages.map((message, index) => ({ ...message, id: `fixture:${ref.id}:${index}` }));
  const seq = hub.currentSeq(ref.id);
  return { session: { id: ref.id, cwd: fixtureCwd, name: fixture.name }, readPath: "classic", epoch: hub.epoch, seq,
    ...(ref.id === "streaming" ? { cut: "sequential", statusSeq: seq } : {}),
    historyId: `fixture:${ref.id}`, page: pageMessagesAtSafeBoundary(messages, { ...page, completeTurns: true }),
    snapshot: { seq, partial: fixture.streaming ? partial : null, tools: [], transientEvents: hub.transientEvents(ref.id) },
    status: { ...idle, isStreaming: fixture.streaming === true }, receipt: null };
}
const services = {
  open: async (ref, page) => open(ref, page),
  earlier: async (ref, page) => {
    if (page.historyId !== `fixture:${ref.id}`) throw new Error("Fixture history changed");
    const result = open(ref, page);
    return { ...result.page, historyId: result.historyId, epoch: result.epoch, seq: result.seq };
  },
  machineListing: async () => ({ sessions: fixtures.map(({ messages, turns, streaming, ...session }) => ({ ...session, modified: "2026-10-14T12:00:00.000Z" })), statuses: [], activities: [] }),
  asksCatalog: () => ({ sessions: [] }),
  unreadCatalog: async () => ({ catalogId: "baseline", sessions: [] }),
  notificationCatalog: () => ({ sessions: [] }),
  messages: async (ref, page) => pageMessagesAtSafeBoundary(find(ref).messages, firstPage ? { ...page, limit: 50 } : page),
  streamSnapshot: async ref => ({ seq: hub.currentSeq(ref.id), partial: find(ref).streaming ? partial : null }),
  status: async ref => ({ ...idle, isStreaming: find(ref).streaming === true }),
  commands: async () => [],
};
registerSessionRoutes(app, services, hub, "/api");
const streaming = fixtures.find(fixture => fixture.id === "streaming");
const savedStreaming = streaming.messages.slice();
app.post("/__fixtures/streaming/reset", async () => {
  streaming.messages = savedStreaming.slice(); streaming.streaming = true;
  partial.content[0].text = "Readable streaming last turn. Working on the deterministic fixture.";
  return { reset: true };
});
app.post("/__fixtures/streaming/complete", async () => {
  const final = { role: "assistant", content: [{ type: "text", text: "Final reply completed while hidden." }], timestamp: partial.timestamp };
  streaming.messages.push(final); streaming.streaming = false;
  hub.publish("streaming", { type: "message.end", message: final });
  hub.publish("streaming", { type: "agent.end" });
  hub.publish("streaming", { type: "status.update", status: idle });
  return { completed: true };
});
const projects = [{ id: "fixture", path: fixtureCwd, name: "Baseline fixtures" }];
app.get("/api/project-groups", async () => ({ groups: [], projects }));
app.get("/api/projects", async () => projects);
app.get("/api/machines/local/projects", async () => projects);
app.get("/api/triggers", async () => ({ triggers: [] }));
// Ancillary panels do not hold up transcript loading. No real machine is contacted.
app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "Not available in the baseline fixture" }));
await app.listen({ port, host: "127.0.0.1" });
process.stdout.write(`fast-chat-open fixtures ready http://127.0.0.1:${port} firstPage=${firstPage}\n`);
const timer = setInterval(() => {
  if (!streaming.streaming) return;
  partial.content[0].text += ".";
  hub.publish("streaming", { type: "assistant.delta", text: "." });
}, 1000);
const stop = async () => { clearInterval(timer); await app.close(); };
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
