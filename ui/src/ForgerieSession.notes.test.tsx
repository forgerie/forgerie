// @vitest-environment happy-dom
import { withOpenFixture } from "./testing/openFixture";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import { createDraftStore } from "./draftStore";
import type { PiMessage, SessionStatus } from "./contracts";
import type { ComposerInputElement } from "./ui/ComposerEditor";
import { markdownView } from "./ui/markdownView";
import { loadMarkdownKit } from "./ui/markdownKit";

let root: Root;
let server: WebSocketServer | undefined;
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const input = () => document.querySelector<ComposerInputElement>(".composer [data-composer-input]")!;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name);
const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 2000 }).toBe(true); });
};
const setValue = (field: HTMLTextAreaElement | ComposerInputElement, text: string) => act(async () => {
  if (field instanceof HTMLTextAreaElement) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
  else field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const click = (node: HTMLElement | undefined) => act(async () => { node!.click(); });
/** The line numbers of one document line in the changes review's editor. */
const numbers = (line: number) => document.querySelector<HTMLElement>(`.cm-diff-numbers [data-line="${String(line)}"]`) ?? undefined;
const chips = () => [...document.querySelectorAll(".note-chip-where")].map((node) => node.textContent);
// The review loads its editor on demand. Loading it once here keeps that cold import out of each test's time limit.
beforeAll(async () => { await Promise.all([import("./ui/DiffEditor"), import("./ui/CodeEditor"), import("./ui/MarkdownEditor"), loadMarkdownKit()]); }, 30_000);
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
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
});

const DIFF = ["diff --git a/src/retry.ts b/src/retry.ts", "--- a/src/retry.ts", "+++ b/src/retry.ts",
  "@@ -7,3 +7,3 @@", " import x;", "-const retries = 3;", "+const retries = 0;", " export {};", ""].join("\n");

/** A session in a registered workspace with one changed file. `refusePrompt` makes Pi refuse the next prompt. */
async function sessionWithChanges(options: { status?: SessionStatus; storage?: Storage; messages?: PiMessage[] } = {}) {
  const status = options.status ?? idle;
  const requests: { path: string; body?: Record<string, unknown> }[] = [];
  const control = { refusePrompt: false };
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(withOpenFixture(async (path, init) => {
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
    if (path === "/api/projects/p/workspaces/w/file?path=docs%2Freport.md") return Response.json({ path: "docs/report.md", content: "# Workspace report", size: 18, binary: false, truncated: false, version: "v:report" });
    if (path === "/api/projects/p/workspaces/w/tree?path=") return Response.json({ entries: [], truncated: false });
    if (path.includes("/messages?")) return Response.json({ messages: options.messages ?? [], start: 0, total: options.messages?.length ?? 0 });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(status);
    if (path.includes("/commands?")) return Response.json([]);
    throw new Error(`Unexpected request ${path}`);
  }));
  const drafts = options.storage ? createDraftStore(options.storage) : undefined;
  await act(async () => root.render(<ForgerieSession id="test" known={{ id: "test", cwd: "/work" }} drafts={drafts} onSwitchSession={() => {}} />));
  await until(() => document.querySelector(".status-chip-live")?.textContent === (status.isStreaming ? "Running" : "Connected"));
  return { requests, control, prompts: () => requests.filter((item) => item.path.endsWith("/prompt")).map((item) => item.body) };
}

/** Open the review, select the removed and the added line, and add a note. */
async function noteTheRetryLimit(comment = "Keep the retry limit.") {
  await click(button("Review changes"));
  await until(() => document.querySelectorAll(".cm-diff-numbers [data-line]").length === 4);
  // Line numbers by document line: 0 is context, 1 the removed line 8, 2 the added line 8.
  await click(numbers(1));
  await click(numbers(2));
  expect(document.querySelector(".note-editor label")?.textContent).toBe("Note on line 8");
  await setValue(document.querySelector<HTMLTextAreaElement>(".note-editor textarea")!, comment);
  await click(button("Add note"));
  await until(() => document.querySelector(".diff-note-text")?.textContent === comment);
}
const retryNote = (comment = "Keep the retry limit.") => ({ path: "src/retry.ts", staged: false, comment, lines: [
  { kind: "remove", oldLineNumber: 8, text: "const retries = 3;" },
  { kind: "add", newLineNumber: 8, text: "const retries = 0;" },
] });

describe("session header status", () => {
  it("keeps a healthy idle session's status for screen readers only, and shows a live chip while the agent runs", async () => {
    await sessionWithChanges();
    expect(document.querySelector<HTMLElement>(".status-chip")?.dataset.tone).toBe("quiet");
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await sessionWithChanges({ status: { ...idle, isStreaming: true } });
    expect(document.querySelector<HTMLElement>(".status-chip")?.dataset.tone).toBe("live");
  });
});

describe("notes on changes", () => {
  it("wires reply links to this session's workspace and reads linked Markdown from that folder", async () => {
    const api = await sessionWithChanges({ messages: [{ role: "assistant", content: [{ type: "text", text: "Read [the report](docs/report.md) and [the rendered report](docs/report.html#results)." }] }] });
    await until(() => document.querySelectorAll('.message-assistant a').length === 2);
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.message-assistant a')];
    expect(links[1]?.getAttribute('href')).toBe(new URL("/api/projects/p/workspaces/w/preview/docs/report.html#results", window.location.href).href);
    await click(links[0]);
    await until(() => api.requests.some((request) => request.path === "/api/projects/p/workspaces/w/file?path=docs%2Freport.md"));
    expect(document.querySelector('dialog.changes-dialog .change-path')?.textContent).toBe("docs/report.md");
  });

  it("opens a Markdown file in the view chosen on this device since the session mounted", async () => {
    markdownView.write("rich");
    await sessionWithChanges({ messages: [{ role: "assistant", content: [{ type: "text", text: "Read [the report](docs/report.md)." }] }] });
    await until(() => document.querySelectorAll(".message-assistant a").length === 1);
    const pressed = () => [...document.querySelectorAll<HTMLButtonElement>('dialog.changes-dialog [role="group"][aria-label="View"] button')]
      .find((node) => node.getAttribute("aria-pressed") === "true")?.textContent;
    const open = async () => {
      await click(document.querySelector<HTMLAnchorElement>(".message-assistant a")!);
      await until(() => pressed() !== undefined && document.querySelector(".changes-body .change-message") === null);
    };
    // Another view, such as a skill file, switches to Source after this session mounted.
    markdownView.write("source");
    await open();
    expect(pressed()).toBe("Source");
    expect(document.querySelector(".changes-body .cm-content")).not.toBeNull();
    await click(button("Close changes"));
    await until(() => !document.querySelector("dialog.changes-dialog"));
    markdownView.write("rich");
    await open();
    expect(pressed()).toBe("Rich");
    expect(document.querySelector('.changes-body [role="textbox"] h1')?.textContent).toBe("Workspace report");
  });

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
    expect(api.prompts()[0]).toEqual({ cwd: "/work", requestId: expect.any(String), text: "Fix these.", diffAnnotations: [retryNote()] });
    await until(() => chips().length === 0);
  });

  it("sends notes alone from an empty message box, and keeps them when Pi refuses the message", async () => {
    const api = await sessionWithChanges();
    await noteTheRetryLimit();
    await click(button("Close changes"));
    api.control.refusePrompt = true;
    await click(button("Send notes"));
    // A refusal from Pi may follow a delivered request, so it is a problem in the status chip.
    await until(() => document.querySelector(".status-chip-live")?.textContent === "Problem");
    await click(document.querySelector<HTMLElement>("button.status-chip-face") ?? undefined);
    await until(() => document.querySelector(".status-chip-panel")?.textContent?.includes("test refusal") === true);
    expect(chips()).toEqual(["retry.ts:8"]);
    api.control.refusePrompt = false;
    await click(button("Send notes"));
    await until(() => chips().length === 0);
    expect(api.prompts().at(-1)).toEqual({ cwd: "/work", requestId: expect.any(String), text: "", diffAnnotations: [retryNote()] });
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
    expect(api.prompts()[0]).toEqual({ cwd: "/work", requestId: expect.any(String), text: "", streamingBehavior: "followUp", diffAnnotations: [retryNote()] });
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
