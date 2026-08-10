// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { initialAppState, type AppState } from "../appState";
import { PiWebApp } from "./PiWebApp";

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

  it("retires the thread header at every size, since its action moved to the composer", async () => {
    for (const width of [499, 1440]) {
      const root = shadowRoot(await mountApp(width));
      expect(root.querySelector("[data-thread-header]")).toBeNull();
    }
  });

  it("keeps the summoned controls reachable from the composer", async () => {
    const app = await mountApp(499);

    expect(shadowRoot(app).querySelector("app-control-sheet")).not.toBeNull();
  });
});

async function mountApp(shellWidth: number): Promise<PiWebApp> {
  const app = new PiWebApp();
  Object.defineProperty(app, "clientWidth", { configurable: true, value: shellWidth });
  document.body.append(app);
  if (!Reflect.set(app, "state", appStateWithSession())) throw new Error("Could not seed PiWebApp state");
  await app.updateComplete;
  return app;
}

function appStateWithSession(): AppState {
  return { ...initialAppState(), selectedSession: session(), mainView: "chat" };
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

function shadowRoot(app: PiWebApp): ShadowRoot {
  const root = app.shadowRoot;
  if (root === null) throw new Error("PiWebApp did not render a shadow root");
  return root;
}
