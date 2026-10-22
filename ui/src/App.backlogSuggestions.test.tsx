// @vitest-environment happy-dom
// The Backlog view's "Suggested in chats": a suggestion filed there, or filed elsewhere while the view is open, leaves the
// group and the backlog list is read again, so the new item (or its "In a session" row) shows where it went.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { browserTransport } from "./sessionStore";
import type { Suggestion } from "./backlog/suggestions/suggestionsApi";
import { answer } from "./backlog/suggestions/fixtures/serverLike";
import { suggestion } from "./backlog/suggestions/fixtures/suggestions";

let root: Root;
let server: WebSocketServer;
let records: Suggestion[];
let backlogReads: number;
const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 3000 }).toBe(true); });
};
/**
 * The Backlog view is a lazy chunk. React draws a resolved lazy component only after the act that waited for it ends,
 * so this waits in short acts instead of one long one.
 */
const settled = async (condition: () => boolean) => {
  for (let tries = 0; tries < 200 && !condition(); tries++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(condition()).toBe(true);
};
const button = (name: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === name);
const row = (title: string) => [...document.querySelectorAll<HTMLElement>(".pending-row")].find((node) => node.textContent?.includes(title));
const emptyBacklog = () => ({ items: [], sources: [], warnings: [], projects: [], generatedAt: "2026-10-21T16:58:00Z" });

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  records = [suggestion("sg-a", { title: "Retry once when the stream drops" }), suggestion("sg-b", { title: "Count early closes per provider" })];
  backlogReads = 0;
  window.history.replaceState({}, "", "/?backlog=");
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(async (path) => {
    if (path === "/api/sessions/all") return Response.json({ sessions: [], statuses: [], activities: [] });
    if (path === "/api/sessions/asks") return Response.json({ sessions: [] });
    if (path === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [] });
    if (path === "/api/machines/local/projects") return Response.json([]);
    return Response.json({ error: `Not in this fixture: ${path}` }, { status: 404 });
  });
  // The Backlog view's routes: the backlog list and the suggestion routes, as the server answers them.
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const path = String(input);
    if (path.startsWith("/api/backlog?")) { backlogReads += 1; return Response.json(emptyBacklog()); }
    if (path.startsWith("/api/backlog/suggestions?") || path === "/api/backlog/suggestions") return Response.json({ suggestions: records });
    const pressed = /^\/api\/backlog\/suggestions\/([^/]+)\/(file|file-and-act)$/u.exec(path);
    if (pressed) {
      const next = answer(records.find((record) => record.id === pressed[1])!, pressed[2] as "file" | "file-and-act");
      records = records.map((record) => record.id === next.id ? next : record);
      return Response.json(next);
    }
    return Response.json({ error: `Not in this fixture: ${path}` }, { status: 404 });
  }));
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("Suggested in chats in the Backlog view", () => {
  it("reads the backlog again once a File there completes", async () => {
    await act(async () => root.render(<App />));
    await settled(() => row("Retry once when the stream drops") !== undefined);
    const before = backlogReads;
    await act(async () => button("File", row("Retry once when the stream drops")!)!.click());
    await until(() => row("Retry once when the stream drops") === undefined);
    await until(() => backlogReads > before);
    expect(row("Count early closes per provider")).toBeDefined();
  });

  it("reads the backlog again when an event says a suggestion was filed elsewhere", async () => {
    await act(async () => root.render(<App />));
    await settled(() => row("Count early closes per provider") !== undefined && server.clients.size > 0);
    const before = backlogReads;
    records = records.map((record) => record.id === "sg-b" ? answer(record, "file-and-act") : record);
    for (const socket of server.clients) socket.send(JSON.stringify({ type: "backlog.suggestions.changed", sessionId: "s-chat", suggestionId: "sg-b" }));
    await until(() => row("Count early closes per provider") === undefined);
    await until(() => backlogReads > before);
  });
});
