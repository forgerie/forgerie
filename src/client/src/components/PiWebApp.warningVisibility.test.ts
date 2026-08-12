import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionStatus } from "../api";
import { initialAppState, type AppState } from "../appState";
// Template inspection is proportionate here because this test verifies only the
// sibling-component callback/property wiring in a node environment without DOM.
import { templateValueAfterMarker } from "../templateInspection.testSupport";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp session-warning visibility wiring", () => {
  it("toggles warning visibility from the warning area itself", () => {
    const app = createApp();
    const state = stateWithWarnings();
    setAppState(app, state);
    syncWarningVisibility(app);

    const visibleChat = renderChatView(app, state);
    expect(templateValueAfterMarker(visibleChat, ".warningsVisible=")).toBe(true);

    templateCallbackAfterMarker(visibleChat, ".onToggleWarnings=")();
    expect(templateValueAfterMarker(renderChatView(app, state), ".warningsVisible=")).toBe(false);

    const otherState = stateWithWarnings("session-2");
    setAppState(app, otherState);
    syncWarningVisibility(app);
    expect(templateValueAfterMarker(renderChatView(app, otherState), ".warningsVisible=")).toBe(true);

    const returningState = { ...state, status: undefined };
    setAppState(app, returningState);
    syncWarningVisibility(app);
    expect(templateValueAfterMarker(renderChatView(app, returningState), ".warningsVisible=")).toBe(true);

    setAppState(app, state);
    syncWarningVisibility(app);
    const returnedChat = renderChatView(app, state);
    expect(templateValueAfterMarker(returnedChat, ".warningsVisible=")).toBe(false);

    templateCallbackAfterMarker(returnedChat, ".onToggleWarnings=")();
    expect(templateValueAfterMarker(renderChatView(app, state), ".warningsVisible=")).toBe(true);
  });
});

type RenderChatView = (this: PiWebApp, state: AppState, session: SessionInfo) => TemplateResult;
type SyncWarningVisibility = (this: PiWebApp) => void;
type WarningVisibilityCallback = () => void;

function createApp(): PiWebApp {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  vi.stubGlobal("window", { location: { search: "" }, localStorage: storage });
  return new PiWebApp();
}

function stateWithWarnings(sessionId = "session-1"): AppState {
  const selectedSession: SessionInfo = {
    id: sessionId,
    cwd: "/repo",
    path: `/repo/${sessionId}.jsonl`,
    created: "2026-07-14T00:00:00.000Z",
    modified: "2026-07-14T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "hello",
  };
  return {
    ...initialAppState(),
    selectedSession,
    status: warningStatus(sessionId),
  };
}

function warningStatus(sessionId: string): SessionStatus {
  return {
    sessionId,
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    warnings: [
      { severity: "warning", message: "subscription auth is active" },
      { severity: "error", message: "skill failed to load" },
    ],
  };
}

function setAppState(app: PiWebApp, state: AppState): void {
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp state");
}

function syncWarningVisibility(app: PiWebApp): void {
  const method: unknown = Reflect.get(app, "syncSessionWarningVisibility");
  if (!isSyncWarningVisibility(method)) throw new Error("PiWebApp.syncSessionWarningVisibility is not callable");
  method.call(app);
}

function renderChatView(app: PiWebApp, state: AppState): TemplateResult {
  const method: unknown = Reflect.get(app, "renderChatView");
  if (!isRenderChatView(method)) throw new Error("PiWebApp.renderChatView is not callable");
  const session = state.selectedSession;
  if (session === undefined) throw new Error("Expected a selected session");
  return method.call(app, state, session);
}

function templateCallbackAfterMarker(template: TemplateResult, marker: string): WarningVisibilityCallback {
  const value = templateValueAfterMarker(template, marker);
  if (!isWarningVisibilityCallback(value)) throw new Error(`Expected callback after ${marker}`);
  return value;
}

function isRenderChatView(value: unknown): value is RenderChatView {
  return typeof value === "function";
}

function isSyncWarningVisibility(value: unknown): value is SyncWarningVisibility {
  return typeof value === "function";
}

function isWarningVisibilityCallback(value: unknown): value is WarningVisibilityCallback {
  return typeof value === "function";
}
