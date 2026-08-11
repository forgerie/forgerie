// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { initialAppState, type AppState } from "../appState";
import { PANEL_PEEK, peekSheetWidth } from "../appShell/panelPeek";
import { PiWebApp } from "./PiWebApp";
import { AppNavigationPanel } from "./appShell/AppNavigationPanel";
import { WorkspacePanel } from "./WorkspacePanel";

/** Folded portrait: nothing docks, so both sheets are worth peeking at. */
const FOLDED_PORTRAIT = 499;
const DESKTOP = 1440;

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("PiWebApp panel peek", () => {
  it("pulls the session list in as a finger travels across the transcript", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);
    const sheetWidth = peekSheetWidth(FOLDED_PORTRAIT);

    await dragAcross(app, sheetWidth * 0.5);

    const sheet = peekSheet(app);
    expect(sheet?.getAttribute("data-side")).toBe("navigation");
    expect(sheet?.style.getPropertyValue("--peek-progress")).toBe("0.5");
  });

  it("drops its easing while a finger is on the sheet, so it does not lag the hand", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);

    await dragAcross(app, peekSheetWidth(FOLDED_PORTRAIT) * 0.5);

    expect(peekSheet(app)?.hasAttribute("data-tracking")).toBe(true);
  });

  it("lets an abandoned look cost nothing", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);

    await dragAcross(app, peekSheetWidth(FOLDED_PORTRAIT) * 0.2, { release: true });

    expect(peekSheet(app)).toBeNull();
  });

  it("opens the sheet when the look was carried far enough", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);

    await dragAcross(app, peekSheetWidth(FOLDED_PORTRAIT) * 0.9, { release: true });

    const sheet = peekSheet(app);
    expect(sheet).not.toBeNull();
    expect(sheet?.hasAttribute("data-tracking")).toBe(false);
    expect(sheet?.style.getPropertyValue("--peek-progress")).toBe("1");
  });

  it("leaves what the user asked of the panel untouched, however far it was pulled", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);

    await dragAcross(app, peekSheetWidth(FOLDED_PORTRAIT) * 0.9, { release: true });

    expect(storedIntents().navigation).toBe("auto");
  });

  it("promotes a look to a decision only through the pin inside the sheet", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);
    await dragAcross(app, peekSheetWidth(FOLDED_PORTRAIT) * 0.9, { release: true });

    pin(app)?.click();
    await app.updateComplete;

    expect(storedIntents().navigation).toBe("pinned");
    expect(peekSheet(app)).toBeNull();
  });

  it("arms over a transcript turn, whose content spills but cannot scroll", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);
    const shell = shellElement(app);
    const turn = document.createElement("div");
    turn.style.overflowX = "visible";
    Object.defineProperty(turn, "scrollWidth", { value: 900, configurable: true });
    Object.defineProperty(turn, "clientWidth", { value: 300, configurable: true });
    shell.append(turn);

    await dragAcross(app, peekSheetWidth(FOLDED_PORTRAIT) * 0.5, { from: turn });

    expect(peekSheet(app)).not.toBeNull();
  });

  it("stands aside once the list has answered the question it was summoned for", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);
    await dragAcross(app, peekSheetWidth(FOLDED_PORTRAIT) * 0.9, { release: true });
    expect(peekSheet(app)).not.toBeNull();

    const panel = shadowRoot(app).querySelector(".peek-sheet app-navigation-panel");
    if (!(panel instanceof AppNavigationPanel)) throw new Error("The sheet did not carry the session list");
    void panel.onSelectSession?.(session());
    await app.updateComplete;

    expect(peekSheet(app)).toBeNull();
  });

  it("carries the workspace tools inside the sheet, where no other strip shows them", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);

    await dragAcross(app, -peekSheetWidth(FOLDED_PORTRAIT) * 0.9, { release: true });

    const panel = shadowRoot(app).querySelector(".peek-sheet workspace-panel");
    if (!(panel instanceof WorkspacePanel)) throw new Error("The sheet did not carry the workspace panel");

    expect(panel.hideToolTabs).toBe(false);
  });

  it("does not offer a panel that is already docked", async () => {
    const app = await mountApp(DESKTOP);

    await dragAcross(app, 200);

    expect(peekSheet(app)).toBeNull();
  });

  it("gives a drag that starts in a sideways scroller back to it", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);
    const shell = shellElement(app);
    // A diff or a table: wider than its box *and* able to scroll to the rest.
    const scroller = document.createElement("div");
    scroller.style.overflowX = "auto";
    Object.defineProperty(scroller, "scrollWidth", { value: 900, configurable: true });
    Object.defineProperty(scroller, "clientWidth", { value: 300, configurable: true });
    shell.append(scroller);

    await dragAcross(app, 200, { from: scroller });

    expect(peekSheet(app)).toBeNull();
  });
});

async function mountApp(shellWidth: number): Promise<PiWebApp> {
  const app = new PiWebApp();
  Object.defineProperty(app, "clientWidth", { configurable: true, value: shellWidth });
  document.body.append(app);
  if (!Reflect.set(app, "state", appStateWithSession())) throw new Error("Could not seed PiWebApp state");
  await app.updateComplete;
  // The shell measures itself after its first render; layout settles on the next.
  await app.updateComplete;
  return app;
}

async function dragAcross(
  app: PiWebApp,
  distancePx: number,
  options: { release?: boolean; from?: Element } = {},
): Promise<void> {
  const source = options.from ?? shellElement(app);
  const start = distancePx < 0 ? 400 : 40;
  const step = distancePx < 0 ? -(PANEL_PEEK.capturePx + 1) : PANEL_PEEK.capturePx + 1;
  source.dispatchEvent(pointerEvent("pointerdown", start, 200));
  // One step past the capture distance, then the rest, as a finger arrives.
  source.dispatchEvent(pointerEvent("pointermove", start + step, 200));
  source.dispatchEvent(pointerEvent("pointermove", start + distancePx, 200));
  if (options.release === true) source.dispatchEvent(pointerEvent("pointerup", start + distancePx, 200));
  await app.updateComplete;
}

function pointerEvent(type: string, clientX: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true, composed: true });
  Object.assign(event, { clientX, clientY, pointerType: "touch", pointerId: 1 });
  return event;
}

function shellElement(app: PiWebApp): Element {
  const shell = shadowRoot(app).querySelector(".shell");
  if (shell === null) throw new Error("PiWebApp did not render a shell");
  return shell;
}

function peekSheet(app: PiWebApp): HTMLElement | null {
  const sheet = shadowRoot(app).querySelector(".peek-sheet");
  return sheet instanceof HTMLElement ? sheet : null;
}

function pin(app: PiWebApp): HTMLElement | null {
  const button = shadowRoot(app).querySelector(".peek-pin");
  return button instanceof HTMLElement ? button : null;
}

function storedIntents(): { navigation: string; workspace: string } {
  const raw = localStorage.getItem("pi-web-panel-intents");
  if (raw === null) return { navigation: "auto", workspace: "auto" };
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return { navigation: "auto", workspace: "auto" };
  const record: Record<string, unknown> = { ...parsed };
  return { navigation: String(record["navigation"]), workspace: String(record["workspace"]) };
}

function appStateWithSession(): AppState {
  return {
    ...initialAppState(),
    selectedSession: session(),
    mainView: "chat",
    messages: [{ role: "user", parts: [{ type: "text", text: "Initial prompt" }] }],
    messagePageEnd: 1,
    messagePageTotal: 1,
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

function shadowRoot(app: PiWebApp): ShadowRoot {
  const root = app.shadowRoot;
  if (root === null) throw new Error("PiWebApp did not render a shadow root");
  return root;
}
