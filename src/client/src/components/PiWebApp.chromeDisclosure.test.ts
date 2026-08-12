// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo, SessionStatus } from "../api";
import { initialAppState, type AppState } from "../appState";
import type { ChatView } from "./ChatView";
import { PiWebApp } from "./PiWebApp";
import type { PromptEditor } from "./PromptEditor";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
});

describe("PiWebApp chrome disclosure", () => {
  it("gives the transcript the whole surface where chrome cannot stay resident", async () => {
    const app = await mountApp(499);
    const root = shadowRoot(app);

    expect(root.querySelector("app-context-bar")).toBeNull();
    expect(root.querySelector("app-mobile-main-tabs")).toBeNull();
    expect(root.querySelector("[data-thread-header]")).toBeNull();
    expect(root.querySelector("chat-view")).not.toBeNull();
    expect(root.querySelector("prompt-editor")).not.toBeNull();
  });

  it("keeps the bands where the shell can afford them", async () => {
    const app = await mountApp(1440);
    const root = shadowRoot(app);

    expect(root.querySelector("app-mobile-main-tabs")).not.toBeNull();
  });

  it("names its band on the shell so layout reads the measured box, not the viewport", async () => {
    expect(shellClasses(await settledApp(1440))).toContain("chrome-resident");
    expect(shellClasses(await settledApp(1100))).toContain("chrome-summoned");
    expect(shellClasses(await settledApp(499))).toContain("chrome-summoned");
  });

  it("hands the measured bands to the panel edges, which cannot see the shell's class", async () => {
    const docked = shadowRoot(await settledApp(1100)).querySelector("app-panel-edge-control[side='navigation']");

    expect(docked?.getAttribute("disclosure")).toBe("summoned");
    expect(docked?.getAttribute("layout")).toBe("docked");

    const overlaid = shadowRoot(await settledApp(499)).querySelector("app-panel-edge-control[side='navigation']");

    expect(overlaid?.getAttribute("layout")).toBe("overlay");
  });

  it("retires the thread header at every size, since its action moved to the composer", async () => {
    for (const width of [499, 1440]) {
      const root = shadowRoot(await mountApp(width));
      expect(root.querySelector("[data-thread-header]")).toBeNull();
    }
  });

  it("keeps direct attachment access in the composer without a control sheet", async () => {
    const app = await mountApp(499);
    const root = shadowRoot(app);
    const composer = root.querySelector<PromptEditor>("prompt-editor");

    expect(root.querySelector("app-control-sheet")).toBeNull();
    await composer?.updateComplete;
    expect(composer?.shadowRoot?.querySelector(".composer-attach")).not.toBeNull();
  });

  it("draws session context progress on the composer island itself, not over the transcript", async () => {
    const app = await mountApp(499, statusWithContext(72));
    const root = shadowRoot(app);
    const composer = root.querySelector<PromptEditor>("prompt-editor");
    const chat = root.querySelector<ChatView>("chat-view");

    expect(root.querySelector("context-usage-meter")).toBeNull();
    await composer?.updateComplete;
    expect(composer?.shadowRoot?.querySelector("context-usage-meter")).not.toBeNull();
    await chat?.updateComplete;
    expect(chat?.shadowRoot?.querySelector("conversation-meter")).toBeNull();
  });

  it("leaves the island's edge unmarked in a session that has barely begun", async () => {
    const app = await mountApp(499, statusWithContext(4));
    const composer = shadowRoot(app).querySelector<PromptEditor>("prompt-editor");

    await composer?.updateComplete;
    expect(composer?.shadowRoot?.querySelector("context-usage-meter")?.shadowRoot?.querySelector(".meter")).toBeNull();
  });
});

async function mountApp(shellWidth: number, status?: SessionStatus): Promise<PiWebApp> {
  const app = new PiWebApp();
  Object.defineProperty(app, "clientWidth", { configurable: true, value: shellWidth });
  document.body.append(app);
  if (!Reflect.set(app, "state", appStateWithSession(status))) throw new Error("Could not seed PiWebApp state");
  await app.updateComplete;
  return app;
}

function appStateWithSession(status?: SessionStatus): AppState {
  return {
    ...initialAppState(),
    selectedSession: session(),
    mainView: "chat",
    messages: [{ role: "user", parts: [{ type: "text", text: "Initial prompt" }] }],
    messagePageEnd: 1,
    messagePageTotal: 1,
    ...(status === undefined ? {} : { status }),
  };
}

function statusWithContext(percent: number): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 50_000, output: 2_000, cacheRead: 0, cacheWrite: 0, total: 52_000 },
    cost: 0,
    contextUsage: { tokens: Math.round(200_000 * (percent / 100)), contextWindow: 200_000, percent },
  };
}

function session(): SessionInfo {
  return {
    id: "session-1",
    path: "/tmp/session-1.jsonl",
    cwd: "/repo",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 2,
    firstMessage: "Initial prompt",
  };
}

/**
 * The shell measures its own box in `hostUpdated`, so the first render still
 * carries the pre-measurement guess. Layout assertions wait for the render that
 * follows the measurement.
 */
async function settledApp(shellWidth: number): Promise<PiWebApp> {
  const app = await mountApp(shellWidth);
  await app.updateComplete;
  return app;
}

function shellClasses(app: PiWebApp): string {
  return shadowRoot(app).querySelector(".shell")?.className ?? "";
}

function shadowRoot(app: PiWebApp): ShadowRoot {
  const root = app.shadowRoot;
  if (root === null) throw new Error("PiWebApp did not render a shadow root");
  return root;
}
