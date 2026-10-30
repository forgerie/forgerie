// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import { withOpenFixture } from "./testing/openFixture";
import { SessionMenu } from "./ui/WorktreeActions";
import type { RelatedWorkRenderer } from "./projectGroups/relatedWork";

let root: Root;
let server: WebSocketServer;
// AppBinding keys its related-work renderer by the session ID. Keep that
// sibling identity here: testing the archive button alone misses collisions.
const relatedWork: RelatedWorkRenderer = ({ ref, busy, commands }) =>
  <SessionMenu key={ref.id} busy={busy} commands={commands} />;
const closeButtons = () => document.querySelectorAll<HTMLButtonElement>(
  '.session-header button[aria-label="Archive and next"], .session-header button[aria-label="Delete and next"]');

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(withOpenFixture(async path => {
    if (path.endsWith("/unread")) return Response.json({ catalogId: "test", sessions: [] });
    if (path.endsWith("/seen")) return Response.json({});
    if (path.includes("/messages?")) return Response.json({ messages: [], start: 0, total: 0 });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json({ isStreaming: false, isCompacting: false, isBashRunning: false });
    if (path.includes("/commands?")) return Response.json([]);
    throw new Error(`Unexpected request ${path}`);
  }));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>(resolve => server.close(() => resolve()));
  document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each([false, true])("keeps exactly one close-and-next control across header updates (ephemeral: %s)", async ephemeral => {
  const onArchive = vi.fn();
  const render = (name: string) => root.render(<ForgerieSession id="session" known={{ id: "session", cwd: "/work", ephemeral, name }}
    archive={{ availability: { type: "ready" }, onArchive }} relatedWork={relatedWork} resourceLens={() => null} onSwitchSession={() => {}} />);
  await act(async () => render("Session"));
  await act(async () => { await expect.poll(() => document.querySelector(".status-chip-live")?.textContent).toBe("Connected"); });
  for (let update = 0; update < 20; update++) await act(async () => render(`Session ${update}`));
  expect(closeButtons()).toHaveLength(1);
  expect(closeButtons()[0]!.getAttribute("aria-label")).toBe(ephemeral ? "Delete and next" : "Archive and next");
  await act(async () => closeButtons()[0]!.click());
  if (ephemeral) {
    expect(onArchive).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"], dialog')?.textContent).toContain("Delete this ephemeral session?");
    await act(async () => document.querySelector<HTMLButtonElement>(".wt-dialog .wt-primary")!.click());
  }
  expect(onArchive).toHaveBeenCalledOnce();
  // The session overflow still opens and exposes its commands after updates.
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Session menu"]')!.click());
  expect(document.querySelector('[role="menu"][aria-label="Session menu"]')).not.toBeNull();
  expect(document.querySelector('[role="menuitem"]')?.textContent).toBe("Skills and prompts");
});
