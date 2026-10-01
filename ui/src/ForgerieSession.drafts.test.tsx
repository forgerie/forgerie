// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import { createDraftStore, type DraftStore } from "./draftStore";
import type { PendingAsk, SessionStatus, UiEvent } from "./contracts";

let root: Root;
let server: WebSocketServer;
/** Session "a"'s status. Every other session is idle. */
let status: SessionStatus;
/** What POST /prompt answers: accepted, or a server failure. */
let promptReply: () => Response;
let seq = 0;
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const ask: PendingAsk = { askId: "ask-1", askedAt: "2026-10-01T00:00:00Z", questions: [
  { id: "db", question: "Which database?", options: [{ value: "pg", label: "Postgres" }, { value: "lite", label: "SQLite" }] },
  { id: "name", question: "What should the service be called?", options: [] },
] };
const input = () => document.querySelector<HTMLTextAreaElement>(".composer textarea")!;
const question = () => document.querySelector(".ask-question")?.textContent;
const checked = () => [...document.querySelectorAll<HTMLInputElement>(".ask-option input:checked")].map((node) => node.parentElement?.textContent);
const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 2000 }).toBe(true); });
};
const type = (text: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), text);
  input().dispatchEvent(new Event("input", { bubbles: true }));
});
const click = (node: Element | null | undefined) => act(async () => { (node as HTMLElement).click(); });
const emit = (event: UiEvent) => act(async () => {
  for (const socket of server.clients) socket.send(JSON.stringify({ ...event, seq: ++seq }));
});
/** Mount one session's view. A new key is a session switch; a new store on the same storage is a reload. */
async function open(id: string, drafts: DraftStore, initialDraft?: string) {
  await act(async () => root.render(<ForgerieSession key={`${id}:${Math.random()}`} id={id} known={{ id, cwd: "/work" }}
    drafts={drafts} initialDraft={initialDraft} onSwitchSession={() => {}} />));
  await until(() => document.querySelector(".connection-status")?.textContent === "Connected"
    || document.querySelector(".connection-status")?.textContent === "Waiting for you");
}
const reload = () => createDraftStore(window.localStorage);

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  status = idle;
  promptReply = () => Response.json({ accepted: true });
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(async (path) => {
    if (path.includes("/messages?")) return Response.json({ messages: [], start: 0, total: 0 });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(path.startsWith("/api/sessions/a/") ? status : idle);
    if (path.includes("/commands?")) return Response.json([]);
    if (path.endsWith("/prompt")) return promptReply();
    throw new Error(`Unexpected request ${path}`);
  });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  document.body.replaceChildren(); window.localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("draft protection across session switches and reloads", () => {
  it("brings the chat draft back to its own session only", async () => {
    const drafts = reload();
    await open("a", drafts);
    await type("unfinished thought for a");
    await open("b", drafts);
    expect(input().value).toBe("");
    await open("a", drafts);
    expect(input().value).toBe("unfinished thought for a");
    await open("a", reload());
    expect(input().value).toBe("unfinished thought for a");
    await type("");
    await open("a", reload());
    expect(input().value).toBe("");
  });

  it("forgets a sent message, and saves the text a failed send puts back", async () => {
    const send = () => click(document.querySelector('[aria-label="Send message"]'));
    await open("a", reload());
    await type("ship it");
    await send();
    await until(() => input().value === "");
    expect(reload().session("a").chat()).toBe("");

    promptReply = () => Response.json({ error: "Model unavailable" }, { status: 503 });
    await type("retry later");
    await send();
    await until(() => document.querySelector('[role="alert"]')?.textContent?.includes("Model unavailable") === true);
    expect(input().value).toBe("retry later");
    await open("a", reload());
    expect(input().value).toBe("retry later");
  });

  it("brings back partial answers and keeps the chat draft parked until the ask closes", async () => {
    const drafts = reload();
    await open("a", drafts);
    await type("chat thought");
    status = { ...idle, pendingAsk: ask };
    await emit({ type: "ask.opened", ask });
    await until(() => question() === "Which database?");
    expect(input().value).toBe("");
    await click([...document.querySelectorAll(".ask-option input")][0]);
    await click(document.querySelector(".ask-primary"));
    await until(() => question() === "What should the service be called?");
    await type("billing");

    await open("b", drafts);
    expect(document.querySelector(".ask")).toBeNull();
    await open("a", reload());
    await until(() => question() === "What should the service be called?");
    expect(input().value).toBe("billing");
    await click(document.querySelector('[aria-label="Previous question"]'));
    expect(checked()).toEqual(["Postgres"]);
    expect(input().value).toBe("");

    status = idle;
    await emit({ type: "ask.closed", askId: ask.askId, reason: "answered" });
    await until(() => document.querySelector(".ask") === null);
    expect(input().value).toBe("chat thought");
    expect(reload().session("a").answers(ask.askId)).toBeUndefined();
    await open("a", reload());
    expect(document.querySelector(".ask")).toBeNull();
    expect(input().value).toBe("chat thought");
  });

  it("starts a newly seen ask blank and never saves the chat draft as its answer", async () => {
    reload().session("a").saveChat("chat thought");
    status = { ...idle, pendingAsk: ask };
    const writes = vi.spyOn(window.localStorage, "setItem");
    await open("a", reload());
    await until(() => question() === "Which database?");
    expect(input().value).toBe("");
    // Not even for one render: the parked chat text is never written as an answer.
    expect(writes.mock.calls.filter(([, value]) => JSON.stringify(JSON.parse(value).ask ?? {}).includes("chat thought"))).toEqual([]);
    expect(reload().session("a").answers(ask.askId)).toBeUndefined();
    expect(reload().session("a").chat()).toBe("chat thought");
  });

  it("drops saved answers when the ask closed while the page was away", async () => {
    reload().session("a").saveAnswers(ask.askId, { index: 1, drafts: { name: { values: [], text: "billing" } } });
    await open("a", reload());
    expect(document.querySelector(".ask")).toBeNull();
    expect(reload().session("a").answers(ask.askId)).toBeUndefined();
  });

  it("lets a forked session's prompt draft replace the draft saved for it", async () => {
    reload().session("fork").saveChat("older text");
    await open("fork", reload(), "edited fork prompt");
    expect(input().value).toBe("edited fork prompt");
    await open("fork", reload());
    expect(input().value).toBe("edited fork prompt");
  });
});
