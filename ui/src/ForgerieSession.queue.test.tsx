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
let server: WebSocketServer | undefined;
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const input = () => document.querySelector<ComposerInputElement>(".composer [data-composer-input]")!;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent === name || node.getAttribute("aria-label") === name);
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
  await act(async () => root.unmount());
  if (server) {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

/** A responding session whose server queues like Pi and publishes each change as status. */
async function respondingSession() {
  let status: SessionStatus = { ...idle, isStreaming: true };
  const prompts: unknown[] = [];
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  let seq = 0;
  const emit = (event: UiEvent) => { for (const socket of server!.clients) socket.send(JSON.stringify({ ...event, seq: ++seq })); };
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  const request = vi.spyOn(browserTransport, "request").mockImplementation(withOpenFixture(async (path, init) => {
    if (path === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [] });
    if (path.endsWith("/prompt")) {
      const body = JSON.parse(String(init.body)) as { text: string; streamingBehavior?: "steer" | "followUp" };
      prompts.push(body);
      const item = { kind: body.streamingBehavior ?? "followUp", text: body.text };
      // Pi delivers steers before follow-ups.
      status = { ...status, queuedMessages: item.kind === "steer"
        ? [...status.queuedMessages.filter((queued) => queued.kind === "steer"), item, ...status.queuedMessages.filter((queued) => queued.kind !== "steer")]
        : [...status.queuedMessages, item] };
      setTimeout(() => emit({ type: "status.update", status }), 0);
      return Response.json({ accepted: true });
    }
    if (path.endsWith("/abort")) {
      const restoredMessages = status.queuedMessages;
      status = idle;
      return Response.json({ aborted: true, restoredMessages });
    }
    if (path.includes("/messages?")) return Response.json({ messages: [], start: 0, total: 0 });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(status);
    if (path.includes("/commands?")) return Response.json([]);
    throw new Error(`Unexpected request ${path}`);
  }));
  await act(async () => root.render(<ForgerieSession id="test" known={{ id: "test", cwd: "/work" }} onSwitchSession={() => {}} />));
  await until(() => button("Stop generating")?.disabled === false);
  return { prompts, request };
}
const rows = () => [...document.querySelectorAll("section.queue .queue-item")].map((row) => row.textContent);

it("queues and steers through Pi, shows Pi's queue, and Stop returns it to the draft in delivery order", async () => {
  const api = await respondingSession();
  await type("add tests after this");
  await act(async () => button("Queue message")!.click());
  await until(() => rows().length === 1);
  await type("use the existing helper");
  await act(async () => button("Steer")!.click());
  await until(() => rows().length === 2);
  expect(api.prompts).toEqual([
    { cwd: "/work", requestId: expect.any(String), text: "add tests after this", streamingBehavior: "followUp" },
    { cwd: "/work", requestId: expect.any(String), text: "use the existing helper", streamingBehavior: "steer" },
  ]);
  expect(rows()).toEqual(["Steer: use the existing helper", "Follow-up: add tests after this"]);
  expect(input().value).toBe("");
  await type("still typing");
  await act(async () => button("Stop generating")!.click());
  await until(() => input().value === "use the existing helper\n\nadd tests after this\n\nstill typing");
  await until(() => rows().length === 0);
});

it("queues deliberate repeated text as a separate send", async () => {
  const api = await respondingSession();
  await type("add tests");
  await act(async () => button("Queue message")!.click());
  await until(() => rows().length === 1);
  await type("add tests");
  await act(async () => button("Queue message")!.click());
  await until(() => rows().length === 2);
  expect(input().value).toBe("");
  expect(api.prompts).toHaveLength(2);
  expect(api.prompts[1]).not.toEqual(api.prompts[0]);
});
