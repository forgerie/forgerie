// @vitest-environment happy-dom

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { textMessage } from "../chatMessages";
import { AuthDialog } from "./AuthDialog";
import { ChatView } from "./ChatView";
import { ModalSurface } from "./ModalSurface";
import { PiWebApp } from "./PiWebApp";
import type { PromptEditor } from "./PromptEditor";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel";
import { WorkspacePanel } from "./WorkspacePanel";

const IMAGE_DATA = "iVBORw0KGgo=";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp global shortcut modality boundary", () => {
  it("runs a global shortcut when the application has no rendered modal", () => {
    const app = new PiWebApp();
    const target = appendKeyTarget();
    const targetKeyDown = vi.fn();
    target.addEventListener("keydown", targetKeyDown);

    const event = dispatchShortcutThroughApp(app, target);

    expect(actionPaletteIsOpen(app)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(targetKeyDown).not.toHaveBeenCalled();
  });

  it("leaves capture-phase keyboard handling with a rendered shared modal", async () => {
    const app = new PiWebApp();
    const target = await openAuthenticationDialog(app);
    const targetKeyDown = vi.fn();
    target.addEventListener("keydown", targetKeyDown);

    const event = dispatchShortcutThroughApp(app, target);

    expect(actionPaletteIsOpen(app)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(targetKeyDown).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "native image zoom", open: openImageZoom },
    { name: "internal upload review", open: openUploadReview },
  ])("leaves capture-phase keyboard handling with the $name", async ({ open }) => {
    const app = new PiWebApp();
    const target = await open(app);
    const targetKeyDown = vi.fn();
    target.addEventListener("keydown", targetKeyDown);

    const event = dispatchShortcutThroughApp(app, target);

    expect(actionPaletteIsOpen(app)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(targetKeyDown).toHaveBeenCalledOnce();
  });

  it("does not suppress shortcuts for session-scoped state that cannot render", () => {
    const app = new PiWebApp();
    setAppState(app, { modelDialog: { title: "Select model", options: [] } });
    const target = appendKeyTarget();

    const event = dispatchShortcutThroughApp(app, target);

    expect(actionPaletteIsOpen(app)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("opens the chat surface without focusing the composer", async () => {
    const app = new PiWebApp();
    setAppState(app, { mainView: "navigation" });
    const focusInput = vi.fn();
    Object.defineProperty(app, "promptEditor", { configurable: true, value: { focusInput } });
    Object.defineProperty(app, "updateComplete", { configurable: true, value: Promise.resolve(true) });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });

    await openChat(app);

    expect(appMainView(app)).toBe("chat");
    expect(focusInput).not.toHaveBeenCalled();
  });

  it("rechecks rendered modality before a delayed prompt focus takes effect", async () => {
    const app = new PiWebApp();
    setAppState(app, { mainView: "chat" });
    const focusInput = vi.fn();
    Object.defineProperty(app, "promptEditor", { configurable: true, value: { focusInput } });
    Object.defineProperty(app, "updateComplete", { configurable: true, value: Promise.resolve(true) });
    let frameCallback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 1;
    });

    const focusing = focusChatComposer(app);
    await vi.waitFor(() => { expect(frameCallback).toBeDefined(); });

    const surface = new ModalSurface();
    surface.initialFocus = "button";
    surface.innerHTML = "<button>Surviving modal</button>";
    document.body.append(surface);
    await surface.updateComplete;
    const modalButton = requiredElement(surface.querySelector<HTMLButtonElement>("button"), "surviving modal button");
    expect(document.activeElement).toBe(modalButton);

    frameCallback?.(performance.now());
    await focusing;

    expect(focusInput).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(modalButton);
  });
});

describe("PiWebApp on-screen keyboard layout", () => {
  it("keeps the composer and omits the session status strip while the keyboard is open", () => {
    const app = new PiWebApp();
    const selectedSession = session("session-keyboard");
    setAppState(app, { selectedSession, sessions: [selectedSession], mainView: "chat" });
    setOnScreenKeyboardOpen(app, true);

    const container = renderApp(app);

    expect(container.querySelector("prompt-editor")).not.toBeNull();
    expect(container.querySelector("status-bar")).toBeNull();
  });

  it("gives the composer the selected session's user prompt history", () => {
    const app = new PiWebApp();
    const selectedSession = session("session-history");
    setAppState(app, {
      selectedSession,
      sessions: [selectedSession],
      mainView: "chat",
      messages: [
        textMessage("user", "first prompt"),
        textMessage("assistant", "answer"),
        textMessage("user", "second prompt"),
      ],
    });

    const container = renderApp(app);
    const editor = requiredElement(container.querySelector<PromptEditor>("prompt-editor"), "prompt editor");

    expect(editor.promptHistory).toEqual(["second prompt", "first prompt"]);
  });
});

type AppKeyDownHandler = (event: KeyboardEvent) => void;
type PromptFocusBoundary = (this: PiWebApp) => Promise<void>;

function dispatchShortcutThroughApp(app: PiWebApp, target: HTMLElement): KeyboardEvent {
  const handler: unknown = Reflect.get(app, "onKeyDown");
  if (!isAppKeyDownHandler(handler)) throw new Error("PiWebApp shortcut handler was unavailable");
  window.addEventListener("keydown", handler, { capture: true });
  const event = new KeyboardEvent("keydown", {
    key: "k",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  try {
    target.dispatchEvent(event);
  } finally {
    window.removeEventListener("keydown", handler, { capture: true });
  }
  return event;
}

async function openAuthenticationDialog(app: PiWebApp): Promise<HTMLElement> {
  setAppState(app, { authDialog: { step: "method" } });
  const container = renderApp(app);
  const dialog = requiredElement(container.querySelector<AuthDialog>("auth-dialog"), "authentication dialog");
  await dialog.updateComplete;
  const surface = requiredElement(dialog.shadowRoot?.querySelector<ModalSurface>("modal-surface"), "authentication modal surface");
  await surface.updateComplete;
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLElement>("button[aria-label='Close']"), "authentication close button");
}

async function openImageZoom(app: PiWebApp): Promise<HTMLElement> {
  const selectedSession = session("session-image");
  setAppState(app, {
    selectedSession,
    sessions: [selectedSession],
    mainView: "chat",
    messages: [{ role: "user", parts: [{ type: "image", mimeType: "image/png", data: IMAGE_DATA }] }],
  });
  const container = renderApp(app);
  const view = requiredElement(container.querySelector<ChatView>("chat-view"), "chat view");
  await view.updateComplete;
  const image = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat-image"), "chat image");
  image.focus();
  image.click();
  await view.updateComplete;
  const dialog = requiredElement(view.shadowRoot?.querySelector<HTMLDialogElement>("dialog.image-zoom"), "image zoom dialog");
  expect(dialog.open).toBe(true);
  return requiredElement(dialog.querySelector<HTMLElement>(".image-zoom-close"), "image zoom close button");
}

async function openUploadReview(app: PiWebApp): Promise<HTMLElement> {
  const selectedWorkspace = workspace();
  setAppState(app, {
    selectedWorkspace,
    workspaces: [selectedWorkspace],
    workspaceTool: "core:workspace.files",
  });
  const container = renderApp(app);
  const panelHost = requiredElement(container.querySelector<WorkspacePanel>("workspace-panel"), "workspace panel");
  await panelHost.updateComplete;
  const panel = requiredElement(panelHost.shadowRoot?.querySelector<WorkspaceFilesPanel>("workspace-files-panel"), "workspace files panel");
  await panel.updateComplete;
  const uploadButton = buttonWithText(panel.shadowRoot, "Upload");
  uploadButton.focus();
  const input = requiredElement(panel.shadowRoot?.querySelector<HTMLInputElement>("#workspace-upload-input"), "workspace upload input");
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["hello"], "hello.txt")] });
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await panel.updateComplete;
  await panel.updateComplete;
  const destination = requiredElement(panel.shadowRoot?.querySelector<HTMLElement>("#workspace-upload-destination"), "upload destination");
  expect(panel.shadowRoot?.activeElement).toBe(destination);
  return destination;
}

function renderApp(app: PiWebApp): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(app.render(), container);
  return container;
}

function focusChatComposer(app: PiWebApp): Promise<void> {
  return invokePromptFocusBoundary(app, "focusChatComposer");
}

function openChat(app: PiWebApp): Promise<void> {
  return invokePromptFocusBoundary(app, "openChat");
}

function invokePromptFocusBoundary(app: PiWebApp, name: string): Promise<void> {
  const method: unknown = Reflect.get(app, name);
  if (!isPromptFocusBoundary(method)) throw new Error(`PiWebApp ${name} boundary was unavailable`);
  return Reflect.apply(method, app, []);
}

function isPromptFocusBoundary(value: unknown): value is PromptFocusBoundary {
  return typeof value === "function";
}

function isAppKeyDownHandler(value: unknown): value is AppKeyDownHandler {
  return typeof value === "function";
}

function appMainView(app: PiWebApp): string {
  const state: unknown = Reflect.get(app, "state");
  if (typeof state !== "object" || state === null || !("mainView" in state)) {
    throw new Error("PiWebApp state was unavailable");
  }
  const { mainView } = state;
  if (typeof mainView !== "string") throw new Error("PiWebApp main view was invalid");
  return mainView;
}

function actionPaletteIsOpen(app: PiWebApp): boolean {
  const state: unknown = Reflect.get(app, "state");
  if (typeof state !== "object" || state === null || !("actionPaletteOpen" in state) || typeof state.actionPaletteOpen !== "boolean") {
    throw new Error("PiWebApp action-palette state was unavailable");
  }
  return state.actionPaletteOpen;
}

function setAppState(app: PiWebApp, patch: Partial<AppState>): void {
  if (!Reflect.set(app, "state", { ...initialAppState(), ...patch })) throw new Error("Could not set PiWebApp state");
}

function setOnScreenKeyboardOpen(app: PiWebApp, open: boolean): void {
  const controller: unknown = Reflect.get(app, "onScreenKeyboard");
  if (typeof controller !== "object" || controller === null || !Reflect.set(controller, "isOpen", open)) {
    throw new Error("Could not update the on-screen keyboard state");
  }
}

function appendKeyTarget(): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Modal action";
  document.body.append(button);
  return button;
}

function buttonWithText(root: ParentNode | null | undefined, text: string): HTMLButtonElement {
  const button = [...(root?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((candidate) => candidate.textContent.trim() === text);
  return requiredElement(button, `${text} button`);
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

function session(id: string): SessionInfo {
  return {
    id,
    cwd: "/repo",
    path: `/repo/${id}.jsonl`,
    created: "2026-07-20T00:00:00.000Z",
    modified: "2026-07-20T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
  };
}

function workspace(): Workspace {
  return {
    id: "workspace-1",
    projectId: "project-1",
    path: "/repo",
    label: "main",
    isMain: true,
    isGitRepo: true,
    isGitWorktree: false,
    effectiveConfig: {},
  };
}
