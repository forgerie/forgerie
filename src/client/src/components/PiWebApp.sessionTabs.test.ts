// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import { SESSION_TABS_STORAGE_KEY } from "../appShell/sessionTabs";
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
  it("raises the band from stored tabs with chat first and the tool closeable", async () => {
    seedStoredTabs({ "local:session-1": [TERMINAL] });
    const app = await mountApp();
    const strip = sessionTabsStrip(app);

    const labels = [...stripRoot(strip).querySelectorAll(".tab .label")].map((label) => label.textContent);
    expect(labels).toEqual(["Chat", "Terminal"]);
    expect(stripRoot(strip).querySelector(".tab.active .label")?.textContent).toBe("Chat");
  });

  it("gives a selected tab the main surface and returns it on the chat tab", async () => {
    seedStoredTabs({ "local:session-1": [TERMINAL] });
    const app = await mountApp();

    await clickTab(app, "Terminal");
    expect(shellClasses(app)).toContain("workspace-view");
    expect(appState(app).workspaceTool).toBe(TERMINAL);
    expect(appState(app).mainView).toBe(TERMINAL);

    await clickTab(app, "Chat");
    expect(shellClasses(app)).toContain("chat-view");
    expect(appState(app).mainView).toBe("chat");
  });

  it("closing the active tab drops the band, the takeover, and the stored entry", async () => {
    seedStoredTabs({ "local:session-1": [TERMINAL] });
    const app = await mountApp();

    await clickTab(app, "Terminal");
    const strip = sessionTabsStrip(app);
    stripRoot(strip).querySelector<HTMLButtonElement>(".tab.active .close")?.click();
    await app.updateComplete;

    expect(shadowRoot(app).querySelector("app-session-tabs")).toBeNull();
    expect(shellClasses(app)).toContain("chat-view");
    expect(localStorage.getItem(SESSION_TABS_STORAGE_KEY)).toBe("{}");
  });

  it("lands on chat when switching to a session without the promoted tool", async () => {
    seedStoredTabs({ "local:session-1": [TERMINAL] });
    const app = await mountApp();

    await clickTab(app, "Terminal");
    expect(appState(app).mainView).toBe(TERMINAL);

    setState(app, { selectedSession: session("session-2") });
    await app.updateComplete;

    expect(appState(app).mainView).toBe("chat");
    expect(shadowRoot(app).querySelector("app-session-tabs")).toBeNull();
  });

  it("keeps the takeover when switching to a session that promoted the same tool", async () => {
    seedStoredTabs({ "local:session-1": [TERMINAL], "local:session-2": [TERMINAL] });
    const app = await mountApp();

    await clickTab(app, "Terminal");
    setState(app, { selectedSession: session("session-2") });
    await app.updateComplete;

    expect(appState(app).mainView).toBe(TERMINAL);
    expect(shadowRoot(app).querySelector("app-session-tabs")).not.toBeNull();
  });

  it("promoting the current workspace tool adds a tab and takes the main surface", async () => {
    const app = await mountApp();
    expect(shadowRoot(app).querySelector("app-session-tabs")).toBeNull();

    promoteSelectedWorkspaceTool(app);
    await app.updateComplete;

    const strip = sessionTabsStrip(app);
    const labels = [...stripRoot(strip).querySelectorAll(".tab .label")].map((label) => label.textContent);
    expect(labels).toEqual(["Chat", "Files"]);
    expect(shellClasses(app)).toContain("workspace-view");
    expect(localStorage.getItem(SESSION_TABS_STORAGE_KEY)).toContain("core:workspace.files");
  });
});

function seedStoredTabs(tabs: Record<string, readonly string[]>): void {
  localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify(tabs));
}

async function mountApp(): Promise<PiWebApp> {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))));
  const app = new PiWebApp();
  Object.defineProperty(app, "clientWidth", { configurable: true, value: 1440 });
  document.body.append(app);
  if (!Reflect.set(app, "state", seededState())) throw new Error("Could not seed PiWebApp state");
  await app.updateComplete;
  await app.updateComplete;
  return app;
}

function seededState(): AppState {
  return {
    ...initialAppState(),
    sessions: [session("session-1"), session("session-2")],
    selectedSession: session("session-1"),
    mainView: "chat",
  };
}

function session(id: string): SessionInfo {
  return {
    id,
    path: `/tmp/${id}.jsonl`,
    cwd: "/repo",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "Initial prompt",
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
