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
import { fixtures, fixtureCwd } from "../ui/scripts/fixtures/fast-chat-open.mjs";
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
const services = {
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
const projects = [{ id: "fixture", path: fixtureCwd, name: "Baseline fixtures" }];
app.get("/api/project-groups", async () => ({ groups: [], projects }));
app.get("/api/projects", async () => projects);
app.get("/api/machines/local/projects", async () => projects);
app.get("/api/triggers", async () => ({ triggers: [] }));
// Ancillary panels do not hold up transcript loading. No real machine is contacted.
app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "Not available in the baseline fixture" }));
await app.listen({ port, host: "127.0.0.1" });
process.stdout.write(`fast-chat-open fixtures ready http://127.0.0.1:${port} firstPage=${firstPage}\n`);
const timer = setInterval(() => hub.publish("streaming", { type: "assistant.delta", text: "." }), 1000);
const stop = async () => { clearInterval(timer); await app.close(); };
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
