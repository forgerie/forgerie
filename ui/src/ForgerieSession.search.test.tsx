// @vitest-environment happy-dom
import { withOpenFixture } from "./testing/openFixture";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import type { SessionStatus } from "./contracts";
import type { SessionTreeSnapshot } from "./sessionTree";
import type { FoundBinding } from "./search/found";

let root: Root;
let server: WebSocketServer;
let status: SessionStatus;
let scrolls: number;
let treeReads: string[];
/** GET /tree answers 404 while set: the server does not know the session. */
let treeMissing: boolean;
const posted: { path: string; body: unknown }[] = [];
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
// Positions 0..4 of the /messages list.
const history = [
  { role: "user", content: "Make the deploy retry", timestamp: 1 },
  { role: "assistant", content: [{ type: "text", text: "The deploy now retries once." }], timestamp: 2 },
  { role: "user", content: "And log it", timestamp: 3 },
  { role: "assistant", content: [{ type: "text", text: "Each deploy retry is logged." }], timestamp: 4 },
  { role: "user", content: "Thanks", timestamp: 5 },
];
const tree: SessionTreeSnapshot = {
  nodes: [
    { id: "u1", parentId: null, kind: "user", summary: "Make the deploy retry" },
    { id: "a1", parentId: "u1", kind: "assistant", summary: "The deploy now retries once." },
    { id: "a-off", parentId: "u1", kind: "assistant", summary: "A warm store makes the deploy fast." },
  ],
  activeLeafId: "a1", activePathIds: ["u1", "a1"],
};
const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 3000 }).toBe(true); });
};
const click = (node: Element | null | undefined) => act(async () => { (node as HTMLElement).click(); });
const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const marked = () => [...document.querySelectorAll(".message[data-marked]")].map((node) => node.textContent ?? "");
const bar = () => document.querySelector('[role="group"][aria-label="Search matches"]')?.textContent ?? "";
const treeDialog = () => document.querySelector("dialog.tree-dialog");
const connected = () => document.querySelector(".status-chip-live") !== null && document.querySelectorAll(".message").length > 0;
const treeRequests = () => posted.filter((request) => request.path.endsWith("/commands/run"));

/** Owns the found hit the way the search binding does: stepping and closing are real. */
function Harness({ initial, onOpened }: { initial: { type: "message"; positions: number[]; current: number } | { type: "entry"; entryId: string } | { type: "missing" }; onOpened?: () => void }) {
  const [current, setCurrent] = useState(initial.type === "message" ? initial.current : 0);
  const [open, setOpen] = useState(true);
  const base = { key: 1, onRetry: () => {}, onClose: () => setOpen(false) };
  const found: FoundBinding | undefined = !open ? undefined : initial.type === "message"
    ? { ...base, type: "message", positions: initial.positions, current,
      onStep: (delta) => setCurrent((at) => (at + delta + initial.positions.length) % initial.positions.length) }
    : initial.type === "entry" ? { ...base, type: "entry", entryId: initial.entryId, onOpened: () => { onOpened?.(); setOpen(false); } }
    : { ...base, type: "pending", state: { type: "missing" } };
  return <ForgerieSession id="a" known={{ id: "a", cwd: "/work" }} onSwitchSession={() => {}} found={found} />;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  status = idle; posted.length = 0; scrolls = 0; treeReads = []; treeMissing = false;
  Element.prototype.scrollTo = function scrollTo() { scrolls += 1; } as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(withOpenFixture(async (path, init) => {
    if (path === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [] });
    if (path.includes("/messages?")) return Response.json({ messages: history, start: 0, total: history.length });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(status);
    if (path.includes("/commands?")) return Response.json([]);
    if (path.startsWith("/api/sessions/a/tree?")) {
      treeReads.push(path);
      return treeMissing ? Response.json({ error: "Session a was not found." }, { status: 404 }) : Response.json({ tree });
    }
    posted.push({ path, body: JSON.parse(String(init.body)) });
    if (path.endsWith("/commands/run")) return Response.json({ type: "tree", tree });
    throw new Error(`Unexpected request ${path}`);
  }));
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("a session opened from an on-branch hit", () => {
  it("marks the matched message, scrolls to it, and steps through the session's matches", async () => {
    await act(async () => root.render(<Harness initial={{ type: "message", positions: [1, 3, 4], current: 0 }} />));
    await until(connected);
    await until(() => marked().length === 1);
    expect(marked()[0]).toContain("The deploy now retries once.");
    await until(() => scrolls > 0);
    expect(bar()).toContain("Match 1 of 3");
    const before = scrolls;
    await click(button("Next match"));
    expect(bar()).toContain("Match 2 of 3");
    await until(() => marked()[0]?.includes("Each deploy retry is logged.") === true);
    expect(marked()).toHaveLength(1);
    await until(() => scrolls > before);
    await click(button("Previous match"));
    await click(button("Previous match"));
    expect(bar()).toContain("Match 3 of 3");
    await until(() => marked()[0]?.includes("Thanks") === true);
    await click(button("Close matches"));
    expect(bar()).toBe("");
    await until(() => marked().length === 0);
  });

  it("says so when the matched message is not in the loaded conversation", async () => {
    await act(async () => root.render(<Harness initial={{ type: "message", positions: [40], current: 0 }} />));
    await until(connected);
    await until(() => bar().includes("This message is not in the loaded conversation."));
    expect(marked()).toEqual([]);
  });
});

describe("a hit whose passage the session no longer holds", () => {
  it("says so, and marks no other message in its place", async () => {
    await act(async () => root.render(<Harness initial={{ type: "missing" }} />));
    await until(connected);
    await until(() => bar().includes("This passage is no longer in the session."));
    expect(marked()).toEqual([]);
    expect(button("Next match")).toBeNull();
  });
});

describe("a session opened from an off-branch hit", () => {
  it("opens the history tree with the hit's entry selected, and leaves the branch alone", async () => {
    const onOpened = vi.fn();
    await act(async () => root.render(<Harness initial={{ type: "entry", entryId: "a-off" }} onOpened={onOpened} />));
    await until(() => treeDialog() !== null);
    expect(treeRequests()).toEqual([{ path: "/api/sessions/a/commands/run", body: { cwd: "/work", text: "/tree" } }]);
    const selected = treeDialog()?.querySelector('[role="treeitem"][aria-selected="true"]');
    expect(selected?.textContent).toContain("A warm store makes the deploy fast.");
    // An assistant entry is hidden under the default lens, so the tree opens on one that shows it.
    expect(treeDialog()?.querySelector('[aria-pressed="true"]')?.textContent).toBe("No tools");
    expect(onOpened).toHaveBeenCalledTimes(1);
    expect(posted.some((request) => request.path.includes("/tree/navigate"))).toBe(false);
  });

  it("waits with a notice while the session works, then opens the tree once it is idle", async () => {
    status = { ...idle, isStreaming: true };
    await act(async () => root.render(<Harness initial={{ type: "entry", entryId: "a-off" }} />));
    await until(() => bar().includes("This match is on another branch."));
    expect(bar()).toContain("The history tree opens when the session is idle.");
    expect(treeRequests()).toEqual([]);
    status = idle;
    await act(async () => { for (const client of server.clients) client.send(JSON.stringify({ type: "status.update", status: idle })); });
    await until(() => treeDialog() !== null);
    expect(treeRequests()).toHaveLength(1);
    expect(treeDialog()?.querySelector('[role="treeitem"][aria-selected="true"]')?.textContent).toContain("A warm store makes the deploy fast.");
    expect(bar()).toBe("");
  });

  it("reads the tree of a read-only session without running /tree, and opens it on the entry to look at only", async () => {
    status = { ...idle, readOnly: true };
    const onOpened = vi.fn();
    await act(async () => root.render(<Harness initial={{ type: "entry", entryId: "a-off" }} onOpened={onOpened} />));
    await until(() => treeDialog() !== null);
    expect(treeReads).toEqual(["/api/sessions/a/tree?cwd=%2Fwork"]);
    expect(treeRequests()).toEqual([]);
    expect(treeDialog()?.querySelector('[role="treeitem"][aria-selected="true"]')?.textContent).toContain("A warm store makes the deploy fast.");
    const action = (name: string) => [...treeDialog()!.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === name);
    expect(action("Continue from here")?.disabled).toBe(true);
    expect(action("Fork")?.disabled).toBe(true);
    expect(action("Summarize")?.disabled).toBe(true);
    expect(treeDialog()?.textContent).toContain("This session is read-only.");
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it("says in the match bar when the server does not know the session's tree, and Retry reads it again", async () => {
    status = { ...idle, readOnly: true };
    treeMissing = true;
    await act(async () => root.render(<Harness initial={{ type: "entry", entryId: "a-off" }} />));
    await until(() => bar().includes("Could not open the history tree."));
    expect(bar()).toContain("Session a was not found.");
    expect(treeDialog()).toBeNull();
    expect(treeReads).toHaveLength(1);
    treeMissing = false;
    await click([...document.querySelectorAll<HTMLButtonElement>('[aria-label="Search matches"] button')].find((node) => node.textContent === "Retry"));
    await until(() => treeDialog() !== null);
    expect(treeReads).toHaveLength(2);
    expect(treeDialog()?.querySelector('[role="treeitem"][aria-selected="true"]')?.textContent).toContain("A warm store makes the deploy fast.");
  });
});
