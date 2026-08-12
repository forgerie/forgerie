// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { initialAppState, type AppState } from "../appState";
import { PANEL_PEEK, PEEK_EXIT_MS, peekSheetWidth } from "../appShell/panelPeek";
import { PiWebApp } from "./PiWebApp";
import { AppPanelControls } from "./appShell/AppPanelControls";
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

  it("sends an abandoned look back the way it came, rather than deleting it", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);

    await dragAcross(app, peekSheetWidth(FOLDED_PORTRAIT) * 0.2, { release: true });

    // Still mounted and fully retracted, so the slide has something to run on.
    const leaving = peekSheet(app);
    expect(leaving).not.toBeNull();
    expect(leaving?.hasAttribute("data-tracking")).toBe(false);
    expect(leaving?.style.getPropertyValue("--peek-progress")).toBe("0");

    await settle(app);

    expect(peekSheet(app)).toBeNull();
  });

  it("takes the sheet off screen once it has finished leaving", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);
    await dragAcross(app, peekSheetWidth(FOLDED_PORTRAIT) * 0.9, { release: true });

    tapScrim(app);
    await app.updateComplete;

    expect(peekSheet(app)).not.toBeNull();

    await settle(app);

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
    // Wide enough that navigation can dock, but dismissed, so it is peekable.
    localStorage.setItem("pi-web-panel-intents", JSON.stringify({ navigation: "dismissed", workspace: "auto" }));
    const app = await mountApp(1000);
    await dragAcross(app, peekSheetWidth(1000) * 0.9, { release: true });

    (await pin(app))?.click();
    await settle(app);

    expect(storedIntents().navigation).toBe("pinned");
    expect(peekSheet(app)).toBeNull();
  });

  it("offers no pin where pinning could not move anything", async () => {
    // A phone has nowhere to dock either panel, so a pin would store a
    // preference and change nothing on screen.
    const app = await mountApp(FOLDED_PORTRAIT);

    await dragAcross(app, peekSheetWidth(FOLDED_PORTRAIT) * 0.9, { release: true });

    expect(peekSheet(app)).not.toBeNull();
    expect(await pin(app)).toBeNull();
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

    const panel = shadowRoot(app).querySelector(".panel-surface[data-mode=\"sheet\"] app-navigation-panel");
    if (!(panel instanceof AppNavigationPanel)) throw new Error("The sheet did not carry the session list");
    void panel.onSelectSession?.(session());
    await settle(app);

    expect(peekSheet(app)).toBeNull();
  });

  it("carries the workspace tools inside the sheet, where no other strip shows them", async () => {
    const app = await mountApp(FOLDED_PORTRAIT);

    await dragAcross(app, -peekSheetWidth(FOLDED_PORTRAIT) * 0.9, { release: true });

    const panel = shadowRoot(app).querySelector(".panel-surface[data-mode=\"sheet\"] workspace-panel");
    if (!(panel instanceof WorkspacePanel)) throw new Error("The sheet did not carry the workspace panel");

    expect(panel.hideToolTabs).toBe(false);
  });

  it("always leaves a way to undock a panel it docked", async () => {
    // A docked panel has no sheet, so its edge control is the only way back out.
    // Losing it strands the panel exactly as a stored pin once did.
    localStorage.setItem("pi-web-panel-intents", JSON.stringify({ navigation: "auto", workspace: "pinned" }));
    const app = await mountApp(979);

    const labels = await panelControlLabels(app, "workspace");

    expect(labels).toContain("Unpin workspace");
    expect(labels).toContain("Close workspace");
  });

  it("leaves a way out of every panel a three-pane shell docks", async () => {
    const app = await mountApp(DESKTOP);

    for (const side of ["navigation", "workspace"] as const) {
      const noun = side === "navigation" ? "sessions" : "workspace";
      const labels = await panelControlLabels(app, side);
      expect(labels).toContain(`Unpin ${noun}`);
      expect(labels).toContain(`Close ${noun}`);
    }
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

/**
 * The panel's controls live inside the panel, beside its own header buttons, so
 * reaching them crosses the panel's shadow boundary. That is the point: an
 * earlier version floated them over the header and covered the commands there.
 */
async function findPanelControls(app: PiWebApp, side: "navigation" | "workspace"): Promise<AppPanelControls | undefined> {
  const surface = shadowRoot(app).querySelector(`.panel-surface[data-side='${side}']`);
  if (surface === null) return undefined;
  const queue: (Element | ShadowRoot)[] = [surface];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    if (node instanceof AppPanelControls) {
      await node.updateComplete;
      return node;
    }
    for (const child of node.children) {
      queue.push(child);
      // Wait before reading: an element that has not rendered yet has no shadow
      // root, and skipping it here loses everything inside the panel.
      if ("updateComplete" in child) await Reflect.get(child, "updateComplete");
      if (child.shadowRoot !== null) queue.push(child.shadowRoot);
    }
  }
  return undefined;
}

async function panelControlLabels(app: PiWebApp, side: "navigation" | "workspace"): Promise<(string | null)[]> {
  const controls = await findPanelControls(app, side);
  if (controls === undefined) return [];
  return [...(controls.shadowRoot?.querySelectorAll("button") ?? [])].map((button) => button.getAttribute("aria-label"));
}

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

/** Waits out the slide a dismissed sheet runs before it leaves the document. */
async function settle(app: PiWebApp): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, PEEK_EXIT_MS + 60); });
  await app.updateComplete;
}

/**
 * A tap as a browser delivers one: a press, a release, then the click. The
 * press matters — it is what tells the shell this gesture has not travelled.
 */
function tapScrim(app: PiWebApp): void {
  const target = scrim(app);
  if (target === null) throw new Error("The sheet had no scrim to tap");
  target.dispatchEvent(pointerEvent("pointerdown", 650, 480));
  target.dispatchEvent(pointerEvent("pointerup", 650, 480));
  target.click();
}

function scrim(app: PiWebApp): HTMLElement | null {
  const el = shadowRoot(app).querySelector(".peek-scrim");
  return el instanceof HTMLElement ? el : null;
}

function peekSheet(app: PiWebApp): HTMLElement | null {
  const sheet = shadowRoot(app).querySelector(".panel-surface[data-mode=\"sheet\"]");
  return sheet instanceof HTMLElement ? sheet : null;
}

async function pin(app: PiWebApp, side: "navigation" | "workspace" = "navigation"): Promise<HTMLElement | null> {
  const controls = await findPanelControls(app, side);
  const button = controls?.shadowRoot?.querySelector("button[data-action='pin']");
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
