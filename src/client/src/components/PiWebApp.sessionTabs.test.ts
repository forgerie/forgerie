// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import { LEGACY_SESSION_TABS_STORAGE_KEY } from "../appShell/sessionTabs";
import { initialAppState, type AppState } from "../appState";
import type { AppSessionTabs } from "./appShell/AppSessionTabs";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
});

const TERMINAL = "core:workspace.terminal";

describe("PiWebApp session tabs", () => {
  it("raises the band from the session's server-owned tabs with chat first and the tool closeable", async () => {
    const { app } = await mountApp({ tabs: { "session-1": [TERMINAL] } });
    const strip = sessionTabsStrip(app);

    const labels = [...stripRoot(strip).querySelectorAll(".tab .label")].map((label) => label.textContent);
    expect(labels).toEqual(["Chat", "Terminal"]);
    expect(stripRoot(strip).querySelector(".tab.active .label")?.textContent).toBe("Chat");
  });

  it("deletes the retired browser-local tab store on connect", async () => {
    localStorage.setItem(LEGACY_SESSION_TABS_STORAGE_KEY, JSON.stringify({ "local:session-1": [TERMINAL] }));
    await mountApp();
    expect(localStorage.getItem(LEGACY_SESSION_TABS_STORAGE_KEY)).toBeNull();
  });

  it("gives a selected tab the main surface and returns it on the chat tab", async () => {
    const { app } = await mountApp({ tabs: { "session-1": [TERMINAL] } });

    await clickTab(app, "Terminal");
    expect(shellClasses(app)).toContain("workspace-view");
    expect(appState(app).workspaceTool).toBe(TERMINAL);
    expect(appState(app).mainView).toBe(TERMINAL);

    await clickTab(app, "Chat");
    expect(shellClasses(app)).toContain("chat-view");
    expect(appState(app).mainView).toBe("chat");
  });

  it("closing the active tab drops the band and the takeover, and replaces the set on the server", async () => {
    const { app, tabsPuts } = await mountApp({ tabs: { "session-1": [TERMINAL] } });

    await clickTab(app, "Terminal");
    const strip = sessionTabsStrip(app);
    stripRoot(strip).querySelector<HTMLElement>(".tab.active .close")?.click();
    await app.updateComplete;

    expect(shadowRoot(app).querySelector("app-session-tabs")).toBeNull();
    expect(shellClasses(app)).toContain("chat-view");
    expect(tabsPuts).toEqual([{ sessionId: "session-1", tabs: [] }]);
  });

  it("lands on chat when switching to a session without the promoted tool", async () => {
    const { app } = await mountApp({ tabs: { "session-1": [TERMINAL] } });

    await clickTab(app, "Terminal");
    expect(appState(app).mainView).toBe(TERMINAL);

    setState(app, { selectedSession: session("session-2") });
    await app.updateComplete;

    expect(appState(app).mainView).toBe("chat");
    expect(shadowRoot(app).querySelector("app-session-tabs")).toBeNull();
  });

  it("keeps the takeover when switching to a session that promoted the same tool", async () => {
    const { app } = await mountApp({ tabs: { "session-1": [TERMINAL], "session-2": [TERMINAL] } });

    await clickTab(app, "Terminal");
    setState(app, { selectedSession: session("session-2", [TERMINAL]) });
    await app.updateComplete;

    expect(appState(app).mainView).toBe(TERMINAL);
    expect(shadowRoot(app).querySelector("app-session-tabs")).not.toBeNull();
  });

  it("returns to chat when another device closes the tab that owns the main surface", async () => {
    const { app } = await mountApp({ tabs: { "session-1": [TERMINAL] } });

    await clickTab(app, "Terminal");
    applyGlobalEvent(app, { type: "session.tabs", sessionId: "session-1", cwd: "/repo", tabs: [] });
    await app.updateComplete;

    expect(appState(app).mainView).toBe("chat");
    expect(shadowRoot(app).querySelector("app-session-tabs")).toBeNull();
  });

  it("promoting the current workspace tool adds a tab, takes the main surface, and writes to the server", async () => {
    const { app, tabsPuts } = await mountApp();
    expect(shadowRoot(app).querySelector("app-session-tabs")).toBeNull();

    promoteSelectedWorkspaceTool(app);
    await app.updateComplete;

    const strip = sessionTabsStrip(app);
    const labels = [...stripRoot(strip).querySelectorAll(".tab .label")].map((label) => label.textContent);
    expect(labels).toEqual(["Chat", "Files"]);
    expect(shellClasses(app)).toContain("workspace-view");
    expect(tabsPuts).toEqual([{ sessionId: "session-1", tabs: ["core:workspace.files"] }]);
  });

  it("restores the previous set when the server rejects the write", async () => {
    const { app } = await mountApp({ rejectTabsPuts: true });

    promoteSelectedWorkspaceTool(app);
    await app.updateComplete;
    expect(shadowRoot(app).querySelector("app-session-tabs")).not.toBeNull();

    await flushAsyncWork(app);
    expect(shadowRoot(app).querySelector("app-session-tabs")).toBeNull();
  });
});

interface MountOptions {
  /** Server-owned tab sets by session id, merged into the session fixtures. */
  tabs?: Record<string, readonly string[]>;
  rejectTabsPuts?: boolean;
}

interface Mounted {
  app: PiWebApp;
  tabsPuts: { sessionId: string; tabs: string[] }[];
}

async function mountApp(options: MountOptions = {}): Promise<Mounted> {
  const tabsPuts: Mounted["tabsPuts"] = [];
  vi.stubGlobal("fetch", vi.fn((input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.href;
    const tabsPut = /\/sessions\/([^/]+)\/tabs(\?|$)/u.exec(url);
    if (tabsPut !== null && init?.method === "PUT") {
      if (options.rejectTabsPuts === true) return Promise.resolve(new Response(JSON.stringify({ error: "nope" }), { status: 500 }));
      if (typeof init.body !== "string") throw new Error("The tabs request body was not JSON text");
      const body: unknown = JSON.parse(init.body);
      const tabs = extractTabs(body);
      tabsPuts.push({ sessionId: tabsPut[1] ?? "", tabs });
      return Promise.resolve(new Response(JSON.stringify({ tabs }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  }));
  const app = new PiWebApp();
  Object.defineProperty(app, "clientWidth", { configurable: true, value: 1440 });
  document.body.append(app);
  if (!Reflect.set(app, "state", seededState(options.tabs ?? {}))) throw new Error("Could not seed PiWebApp state");
  await app.updateComplete;
  await app.updateComplete;
  return { app, tabsPuts };
}

function extractTabs(body: unknown): string[] {
  if (typeof body !== "object" || body === null) throw new Error("The tabs request had no body");
  const tabs: unknown = Reflect.get(body, "tabs");
  if (!Array.isArray(tabs) || !tabs.every((entry): entry is string => typeof entry === "string")) {
    throw new Error("The tabs request body was malformed");
  }
  return tabs;
}

function seededState(tabs: Record<string, readonly string[]>): AppState {
  return {
    ...initialAppState(),
    sessions: [session("session-1", tabs["session-1"]), session("session-2", tabs["session-2"])],
    selectedSession: session("session-1", tabs["session-1"]),
    mainView: "chat",
  };
}

function session(id: string, tabs?: readonly string[]): SessionInfo {
  return {
    id,
    path: `/tmp/${id}.jsonl`,
    cwd: "/repo",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "Initial prompt",
    ...(tabs === undefined || tabs.length === 0 ? {} : { tabs: [...tabs] }),
  };
}

async function clickTab(app: PiWebApp, label: string): Promise<void> {
  const strip = sessionTabsStrip(app);
  const tab = [...stripRoot(strip).querySelectorAll<HTMLElement>(".tab")]
    .find((candidate) => candidate.querySelector(".label")?.textContent === label);
  if (tab === undefined) throw new Error(`No session tab labelled ${label}`);
  tab.click();
  await app.updateComplete;
  await strip.updateComplete;
}

/** Settle the optimistic write's rejection path: the fetch, the revert, and the re-render. */
async function flushAsyncWork(app: PiWebApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await app.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await app.updateComplete;
}

function sessionTabsStrip(app: PiWebApp): AppSessionTabs {
  const strip = shadowRoot(app).querySelector<AppSessionTabs>("app-session-tabs");
  if (strip === null) throw new Error("Expected the session tab band");
  return strip;
}

function shadowRoot(app: PiWebApp): ShadowRoot {
  const root = app.shadowRoot;
  if (root === null) throw new Error("PiWebApp did not render a shadow root");
  return root;
}

function shellClasses(app: PiWebApp): string {
  return shadowRoot(app).querySelector(".shell")?.className ?? "";
}

function stripRoot(strip: AppSessionTabs): ShadowRoot {
  const root = strip.shadowRoot;
  if (root === null) throw new Error("AppSessionTabs did not render a shadow root");
  return root;
}

/** String-typed view of the fields these tests assert; comparisons stay by value. */
function appState(app: PiWebApp): { mainView: string; workspaceTool: string } {
  const state: unknown = Reflect.get(app, "state");
  if (typeof state !== "object" || state === null) throw new Error("PiWebApp state is unavailable");
  const mainView: unknown = Reflect.get(state, "mainView");
  const workspaceTool: unknown = Reflect.get(state, "workspaceTool");
  if (typeof mainView !== "string" || typeof workspaceTool !== "string") throw new Error("PiWebApp state shape is invalid");
  return { mainView, workspaceTool };
}

function setState(app: PiWebApp, patch: Partial<AppState>): void {
  const method: unknown = Reflect.get(app, "setState");
  if (typeof method !== "function") throw new Error("PiWebApp.setState is not callable");
  method.call(app, patch);
}

/** Promote is a private seam; the button's own wiring is covered by AppPanelControls rendering it. */
function promoteSelectedWorkspaceTool(app: PiWebApp): void {
  const method: unknown = Reflect.get(app, "promoteSelectedWorkspaceTool");
  if (typeof method !== "function") throw new Error("PiWebApp.promoteSelectedWorkspaceTool is not callable");
  method.call(app);
}

/** Drive the realtime path the websocket would: the session controller's global-event entry. */
function applyGlobalEvent(app: PiWebApp, event: unknown): void {
  const controller: unknown = Reflect.get(app, "sessions");
  if (typeof controller !== "object" || controller === null) throw new Error("PiWebApp.sessions is unavailable");
  const method: unknown = Reflect.get(controller, "applyGlobalEvent");
  if (typeof method !== "function") throw new Error("SessionController.applyGlobalEvent is not callable");
  method.call(controller, event);
}
