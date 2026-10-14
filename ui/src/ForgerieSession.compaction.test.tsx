// @vitest-environment happy-dom
import { withOpenFixture } from "./testing/openFixture";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import type { SessionStatus, UiEvent } from "./contracts";
import type { ComposerInputElement } from "./ui/ComposerEditor";

let root: Root;
let server: WebSocketServer;
let releaseAbort: (() => void) | undefined;
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const input = () => document.querySelector<ComposerInputElement>(".composer [data-composer-input]")!;
const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 2000 }).toBe(true); });
};
const type = (text: string) => act(async () => {
  input().value = text;
  input().dispatchEvent(new Event("input", { bubbles: true }));
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  releaseAbort?.(); releaseAbort = undefined;
  await act(async () => root.unmount());
  if (server) {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each([false, true])("restores Stop's returned queue only to chat, with a delayed ask = %s", async (opensAsk) => {
  let status: SessionStatus = { ...idle, isStreaming: true, queuedMessages: [{ kind: "followUp", text: "/compact keep deployment notes" }] };
  const aborted = new Promise<void>((resolve) => { releaseAbort = resolve; });
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  const request = vi.spyOn(browserTransport, "request").mockImplementation(withOpenFixture(async (path) => {
    if (path === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [] });
    if (path.endsWith("/abort")) {
      const restoredMessages = status.queuedMessages;
      await aborted;
      status = { ...status, isStreaming: false, queuedMessages: [] };
      return Response.json({ aborted: true, restoredMessages });
    }
    if (path.includes("/messages?")) return Response.json({ messages: [], start: 0, total: 0 });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(status);
    if (path.includes("/commands?")) return Response.json([]);
    throw new Error(`Unexpected request ${path}`);
  }));
  await act(async () => root.render(<ForgerieSession id="test" known={{ id: "test", cwd: "/work" }} onSwitchSession={() => {}} />));
  await until(() => document.querySelector<HTMLButtonElement>('[aria-label="Stop generating"]')?.disabled === false);
  await type("unfinished chat thought");
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Stop generating"]')!.click());
  await until(() => request.mock.calls.some(([path]) => path.endsWith("/abort")));
  let seq = 0;
  const emit = async (event: UiEvent) => act(async () => {
    for (const socket of server.clients) socket.send(JSON.stringify({ ...event, seq: ++seq }));
  });
  if (opensAsk) {
    const ask = { askId: "new-ask", askedAt: "now", questions: [{ id: "q", question: "Which tests?", options: [] }] };
    status = { ...status, pendingAsk: ask };
    await emit({ type: "ask.opened", ask });
    await until(() => document.querySelector(".ask") !== null);
    await type("my current answer");
  }
  await act(async () => releaseAbort!());
  await until(() => request.mock.calls.filter(([path]) => path.includes("/status?")).length >= 2);
  if (opensAsk) {
    expect(input().value).toBe("my current answer");
    await emit({ type: "ask.closed", askId: "new-ask", reason: "cancelled" });
    await until(() => document.querySelector(".ask") === null);
  }
  expect(input().value).toBe("/compact keep deployment notes\n\nunfinished chat thought");
  expect(document.querySelectorAll(".composer [data-composer-input]")).toHaveLength(1);
  expect(request.mock.calls.filter(([path]) => path.endsWith("/abort"))).toHaveLength(1);
});
