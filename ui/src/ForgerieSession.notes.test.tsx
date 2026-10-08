// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import { createDraftStore } from "./draftStore";
import type { SessionStatus } from "./contracts";

let root: Root;
let server: WebSocketServer | undefined;
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const input = () => document.querySelector<HTMLTextAreaElement>(".composer textarea")!;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name);
const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 2000 }).toBe(true); });
};
const setValue = (field: HTMLTextAreaElement, text: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const click = (node: HTMLElement | undefined) => act(async () => { node!.click(); });
const chips = () => [...document.querySelectorAll(".note-chip-where")].map((node) => node.textContent);
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

const DIFF = ["diff --git a/src/retry.ts b/src/retry.ts", "--- a/src/retry.ts", "+++ b/src/retry.ts",
  "@@ -7,3 +7,3 @@", " import x;", "-const retries = 3;", "+const retries = 0;", " export {};", ""].join("\n");

/** A session in a registered workspace with one changed file. `refusePrompt` makes Pi refuse the next prompt. */
async function sessionWithChanges(options: { status?: SessionStatus; storage?: Storage } = {}) {
  const status = options.status ?? idle;
  const requests: { path: string; body?: Record<string, unknown> }[] = [];
  const control = { refusePrompt: false };
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(async (path, init) => {
    if (path === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [] });
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ path, ...(body ? { body } : {}) });
    if (path.endsWith("/prompt")) {
      if (control.refusePrompt) return Response.json({ error: "Invalid diffAnnotations: test refusal." }, { status: 400 });
      return Response.json({ accepted: true });
    }
    if (path.endsWith("/shell")) return Response.json({ accepted: true });
    if (path === "/api/projects") return Response.json([{ id: "p", path: "/work" }]);
    if (path === "/api/projects/p/workspaces") return Response.json([{ id: "w", projectId: "p", path: "/work" }]);
    if (path === "/api/projects/p/workspaces/w/git/status") return Response.json({ isGitRepo: true, hash: "h", branch: "main", submodules: [],
      files: [{ path: "src/retry.ts", index: "unmodified", workingTree: "modified" }] });
    if (path.startsWith("/api/projects/p/workspaces/w/git/diff?")) return Response.json({ path: "src/retry.ts", staged: false, hash: "h", diff: DIFF, truncated: false });
    if (path.includes("/messages?")) return Response.json({ messages: [], start: 0, total: 0 });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(status);
    if (path.includes("/commands?")) return Response.json([]);
    throw new Error(`Unexpected request ${path}`);
  });
  const drafts = options.storage ? createDraftStore(options.storage) : undefined;
  await act(async () => root.render(<ForgerieSession id="test" known={{ id: "test", cwd: "/work" }} drafts={drafts} onSwitchSession={() => {}} />));
  await until(() => document.querySelector(".connection-status")?.textContent === (status.isStreaming ? "Running" : "Connected"));
  return { requests, control, prompts: () => requests.filter((item) => item.path.endsWith("/prompt")).map((item) => item.body) };
}

/** Open the review, select the removed and the added line, and add a note. */
async function noteTheRetryLimit(comment = "Keep the retry limit.") {
  await click(button("Review changes"));
  await until(() => document.querySelectorAll(".diff-gutter").length === 4);
  await click(button("Select removed line 8"));
  await click(button("Stretch the selection to added line 8"));
  expect(document.querySelector(".note-editor label")?.textContent).toBe("Note on line 8");
  await setValue(document.querySelector<HTMLTextAreaElement>(".note-editor textarea")!, comment);
  await click(button("Add note"));
  await until(() => document.querySelector(".diff-note-text")?.textContent === comment);
}
const retryNote = (comment = "Keep the retry limit.") => ({ path: "src/retry.ts", staged: false, comment, lines: [
  { kind: "remove", oldLineNumber: 8, text: "const retries = 3;" },
  { kind: "add", newLineNumber: 8, text: "const retries = 0;" },
] });

describe("notes on changes", () => {
  it("turns selected diff lines into a note that goes with the next message as structured annotations, then leaves the tray", async () => {
    const api = await sessionWithChanges();
    await noteTheRetryLimit();
    expect(document.querySelector(".changes-foot p")?.textContent).toBe("1 note goes with your next message.");
    await click(button("Write message"));
    await until(() => !document.querySelector("dialog.changes-dialog"));
    expect(chips()).toEqual(["retry.ts:8"]);
    expect(button("Review changes, 1 note waiting")).toBeTruthy();

    await setValue(input(), "Fix these.");
    await click(button("Send message"));
    await until(() => api.prompts().length === 1);
    expect(api.prompts()[0]).toEqual({ cwd: "/work", text: "Fix these.", diffAnnotations: [retryNote()] });
    await until(() => chips().length === 0);
  });

  it("sends notes alone from an empty message box, and keeps them when Pi refuses the message", async () => {
    const api = await sessionWithChanges();
    await noteTheRetryLimit();
    await click(button("Close changes"));
    api.control.refusePrompt = true;
    await click(button("Send notes"));
    await until(() => document.querySelector(".notice")?.textContent?.includes("test refusal") === true);
    expect(chips()).toEqual(["retry.ts:8"]);
    api.control.refusePrompt = false;
    await click(button("Send notes"));
    await until(() => chips().length === 0);
    expect(api.prompts().at(-1)).toEqual({ cwd: "/work", text: "", diffAnnotations: [retryNote()] });
  });

  it("leaves notes waiting while a `!` command runs, and says so", async () => {
    const api = await sessionWithChanges();
    await noteTheRetryLimit();
    await click(button("Close changes"));
    await setValue(input(), "!ls");
    expect(document.querySelector(".composer-hint")?.textContent).toContain("Your notes wait for your next message.");
    await click(button("Run command"));
    await until(() => api.requests.some((item) => item.path.endsWith("/shell")));
    expect(api.requests.find((item) => item.path.endsWith("/shell"))?.body).toEqual({ cwd: "/work", text: "!ls" });
    expect(chips()).toEqual(["retry.ts:8"]);
  });

  it("queues notes alone as a follow-up while the agent works", async () => {
    const api = await sessionWithChanges({ status: { ...idle, isStreaming: true } });
    await noteTheRetryLimit();
    await click(button("Close changes"));
    await click(button("Queue message"));
    await until(() => api.prompts().length === 1);
    expect(api.prompts()[0]).toEqual({ cwd: "/work", text: "", streamingBehavior: "followUp", diffAnnotations: [retryNote()] });
  });

  it("edits and removes a note in the review, and opens the review at a note from its chip", async () => {
    await sessionWithChanges();
    await noteTheRetryLimit();
    await click(button("Edit note"));
    await setValue(document.querySelector<HTMLTextAreaElement>(".note-editor textarea")!, "Make it 5.");
    await click(button("Save note"));
    await until(() => document.querySelector(".diff-note-text")?.textContent === "Make it 5.");
    await click(button("Close changes"));
    await click(button("Note on retry.ts:8: Make it 5."));
    await until(() => document.querySelector("dialog.changes-dialog [data-note-id]") !== null);
    await click(button("Remove note"));
    await until(() => !document.querySelector(".diff-note-text"));
    expect(document.querySelector(".changes-foot")).toBeNull();
  });

  it("keeps notes across a reload with the session's drafts", async () => {
    const items = new Map<string, string>();
    const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); },
      removeItem: (key: string) => { items.delete(key); } } as Storage;
    await sessionWithChanges({ storage });
    await noteTheRetryLimit();
    await act(async () => root.unmount());
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<ForgerieSession id="test" known={{ id: "test", cwd: "/work" }} drafts={createDraftStore(storage)} onSwitchSession={() => {}} />));
    await until(() => chips().length === 1);
  });
});
