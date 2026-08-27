// @vitest-environment happy-dom

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { keyboardShortcutContextForEvent } from "../keyboardContext";
import { textMessage } from "../chatMessages";
import { SessionController } from "../controllers/sessionController";
import { selectedChatLiveReady, selectedChatTarget } from "../selectedChatLoad";
import { AuthDialog } from "./AuthDialog";
import { ChatView } from "./ChatView";
import type { ImageLightbox } from "./ImageLightbox";
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
  window.history.replaceState({}, "", "/");
  vi.useRealTimers();
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

  it("opens New session with Ctrl+Enter even when no workspace is selected", () => {
    const app = new PiWebApp();
    const target = appendKeyTarget();

    const event = dispatchKeyThroughApp(app, target, "Enter");

    expect(newSessionComposerRequest(app)).toEqual({ kind: "open" });
    expect(event.defaultPrevented).toBe(true);
  });

  it("opens New session with Rapidfire enabled before CodeMirror handles Ctrl+Shift+Enter", async () => {
    const { app, editor } = await renderChatEditor({});
    const onSend = vi.fn();
    const editorKeyDown = vi.fn();
    editor.onSend = onSend;
    editor.replaceText("keep this chat draft");
    editor.view?.contentDOM.addEventListener("keydown", editorKeyDown);

    const event = dispatchEditorKeyThroughApp(app, editor, "Enter", { ctrlKey: true, shiftKey: true });

    expect(newSessionComposerRequest(app)).toEqual({ kind: "open", initialLaunchMode: "rapidfire" });
    expect(onSend).not.toHaveBeenCalled();
    expect(editorKeyDown).not.toHaveBeenCalled();
    expect(editor.view?.state.doc.toString()).toBe("keep this chat draft");
    expect(event.defaultPrevented).toBe(true);
  });

  it("opens New session before CodeMirror handles Ctrl+Enter and preserves the chat draft", async () => {
    const { app, editor } = await renderChatEditor({});
    const onSend = vi.fn();
    const editorKeyDown = vi.fn();
    editor.onSend = onSend;
    editor.replaceText("keep this chat draft");
    editor.view?.contentDOM.addEventListener("keydown", editorKeyDown);

    const event = dispatchEditorKeyThroughApp(app, editor, "Enter", { ctrlKey: true });

    expect(newSessionComposerIsOpen(app)).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    expect(editorKeyDown).not.toHaveBeenCalled();
    expect(editor.view?.state.doc.toString()).toBe("keep this chat draft");
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Meta+Enter with CodeMirror and does not open a session", async () => {
    const { app, editor } = await renderChatEditor({});
    const editorKeyDown = vi.fn();
    editor.replaceText("keep this chat draft");
    editor.view?.contentDOM.addEventListener("keydown", editorKeyDown);

    const event = dispatchEditorKeyThroughApp(app, editor, "Enter", { metaKey: true });

    expect(newSessionComposerIsOpen(app)).toBe(false);
    expect(editorKeyDown).toHaveBeenCalledOnce();
    expect(editor.view?.state.doc.toString()).toBe("keep this chat draft");
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps the Keyboard settings chord leader out of the composer", async () => {
    const { app, editor } = await renderChatEditor({});
    const editorKeyDown = vi.fn();
    editor.view?.contentDOM.addEventListener("keydown", editorKeyDown);

    dispatchEditorKeyThroughApp(app, editor, "k", { ctrlKey: true });

    expect(editorKeyDown).toHaveBeenCalledOnce();
    expect(new URL(window.location.href).searchParams.get("settings")).toBeNull();
  });

  it.each([
    { name: "remapped", shortcuts: { "core:session.start": "alt+n" } },
    { name: "disabled", shortcuts: { "core:session.start": null } },
  ])("honors a $name New session preference from editor focus", async ({ shortcuts }) => {
    const { app, editor } = await renderChatEditor(shortcuts);
    const onSend = vi.fn();
    editor.onSend = onSend;
    editor.replaceText("send with existing behavior");

    const event = dispatchEditorKeyThroughApp(app, editor, "Enter", { ctrlKey: true });

    expect(newSessionComposerIsOpen(app)).toBe(false);
    expect(onSend).toHaveBeenCalledWith("send with existing behavior", undefined, undefined, undefined);
    expect(event.defaultPrevented).toBe(true);
  });

  it("runs the configured idle double-Escape action through the session command flow", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { app, editor } = await renderChatEditor({});
    editor.doubleEscapeAction = "fork";
    const runCommand = vi.spyOn(appSessionController(app), "runCommand").mockResolvedValue(undefined);

    dispatchEditorKeyThroughApp(app, editor, "Escape", {});
    vi.advanceTimersByTime(499);
    dispatchEditorKeyThroughApp(app, editor, "Escape", {});

    expect(runCommand).toHaveBeenCalledExactlyOnceWith("/fork");
  });

  it("does not run a composer-scoped shortcut from a generic text field", () => {
    const app = new PiWebApp();
    const input = document.createElement("input");
    document.body.append(input);

    const event = dispatchKeyThroughApp(app, input, "Enter", { ctrlKey: true });

    expect(newSessionComposerIsOpen(app)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("opens New session through the global dispatcher with a configured alternate shortcut", async () => {
    const { app, editor } = await renderChatEditor({ "core:session.start": "alt+n" });
    const onSend = vi.fn();
    const editorKeyDown = vi.fn();
    editor.onSend = onSend;
    editor.replaceText("alternate shortcut draft");
    editor.view?.contentDOM.addEventListener("keydown", editorKeyDown);
    let context: ReturnType<typeof keyboardShortcutContextForEvent> | undefined;
    const readContext = (keyboardEvent: KeyboardEvent) => { context = keyboardShortcutContextForEvent(keyboardEvent); };
    window.addEventListener("keydown", readContext, { capture: true, once: true });

    const event = dispatchEditorKeyThroughApp(app, editor, "n", { altKey: true });

    expect(context).toBe("composer");
    expect(newSessionComposerIsOpen(app)).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    expect(editorKeyDown).not.toHaveBeenCalled();
    expect(editor.view?.state.doc.toString()).toBe("alternate shortcut draft");
    expect(event.defaultPrevented).toBe(true);
  });

  it("opens Keyboard settings with the VS Code chord", () => {
    const app = new PiWebApp();
    const target = appendKeyTarget();

    const first = dispatchKeyThroughApp(app, target, "k", { ctrlKey: true });
    const second = dispatchKeyThroughApp(app, target, "s", { ctrlKey: true });

    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
    expect(new URL(window.location.href).searchParams.get("settings")).toBe("shortcuts");
  });

  it("keeps workbench-only custom shortcuts out of terminal input", () => {
    const app = new PiWebApp();
    Reflect.set(app, "shortcutConfig", { "app.navigation.focus-sessions": "ctrl+c" });
    const terminal = document.createElement("div");
    terminal.setAttribute("data-keyboard-shortcut-context", "terminal");
    const input = document.createElement("textarea");
    terminal.append(input);
    document.body.append(terminal);
    const terminalKeyDown = vi.fn();
    input.addEventListener("keydown", terminalKeyDown);

    const event = dispatchKeyThroughApp(app, input, "c", { ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(terminalKeyDown).toHaveBeenCalledOnce();
  });

  it("keeps the Keyboard settings chord leader out of terminal input", () => {
    const app = new PiWebApp();
    const terminal = document.createElement("div");
    terminal.setAttribute("data-keyboard-shortcut-context", "terminal");
    const input = document.createElement("textarea");
    terminal.append(input);
    document.body.append(terminal);
    const terminalKeyDown = vi.fn();
    input.addEventListener("keydown", terminalKeyDown);

    const event = dispatchKeyThroughApp(app, input, "k", { ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(terminalKeyDown).toHaveBeenCalledOnce();
  });

  it("runs declared app-wide shortcuts from terminal input", () => {
    const app = new PiWebApp();
    const terminal = document.createElement("div");
    terminal.setAttribute("data-keyboard-shortcut-context", "terminal");
    const input = document.createElement("textarea");
    terminal.append(input);
    document.body.append(terminal);

    const event = dispatchShortcutThroughApp(app, input);

    expect(actionPaletteIsOpen(app)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
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

  it("does not carry a pending chord across a rendered modal", async () => {
    const app = new PiWebApp();
    const target = appendKeyTarget();

    expect(dispatchKeyThroughApp(app, target, "k", { ctrlKey: true }).defaultPrevented).toBe(true);
    const modalTarget = await openAuthenticationDialog(app);
    expect(dispatchKeyThroughApp(app, modalTarget, "s", { ctrlKey: true }).defaultPrevented).toBe(false);

    document.body.replaceChildren();
    await Promise.resolve();
    const afterModal = appendKeyTarget();
    const event = dispatchKeyThroughApp(app, afterModal, "s", { ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(new URL(window.location.href).searchParams.get("settings")).toBeNull();
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
  it("keeps the composer, the only thing left below the transcript, while the keyboard is open", () => {
    const app = new PiWebApp();
    const selectedSession = session("session-keyboard");
    setAppState(app, { selectedSession, sessions: [selectedSession], mainView: "chat" });
    setOnScreenKeyboardOpen(app, true);

    const container = renderApp(app);

    expect(container.querySelector("prompt-editor")).not.toBeNull();
    expect(container.querySelector("status-bar")).toBeNull();
    expect(container.querySelector("app-control-sheet")).toBeNull();
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
  return dispatchKeyThroughApp(app, target, "p", { ctrlKey: true, shiftKey: true });
}

function dispatchKeyThroughApp(app: PiWebApp, target: HTMLElement, key: string, modifiers: Partial<KeyboardEventInit> = { ctrlKey: true }): KeyboardEvent {
  const handler: unknown = Reflect.get(app, "onKeyDown");
  if (!isAppKeyDownHandler(handler)) throw new Error("PiWebApp shortcut handler was unavailable");
  window.addEventListener("keydown", handler, { capture: true });
  const event = new KeyboardEvent("keydown", {
    key,
    ...modifiers,
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

function dispatchEditorKeyThroughApp(
  app: PiWebApp,
  editor: PromptEditor,
  key: string,
  modifiers: Partial<KeyboardEventInit>,
): KeyboardEvent {
  const contentDOM = editor.view?.contentDOM;
  if (contentDOM === undefined) throw new Error("Expected CodeMirror contentDOM");
  return dispatchKeyThroughApp(app, contentDOM, key, modifiers);
}

async function renderChatEditor(shortcuts: Record<string, string | null>): Promise<{ app: PiWebApp; editor: PromptEditor }> {
  const app = new PiWebApp();
  const selectedSession = session("session-shortcut");
  setAppState(app, {
    selectedSession,
    sessions: [selectedSession],
    selectedChatLoad: selectedChatLiveReady(selectedChatTarget("local", selectedSession)),
    mainView: "chat",
  });
  Reflect.set(app, "shortcutConfig", shortcuts);
  const editor = requiredElement(renderApp(app).querySelector<PromptEditor>("prompt-editor"), "prompt editor");
  await editor.updateComplete;
  return { app, editor };
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
  const lightbox = requiredElement(view.shadowRoot?.querySelector<ImageLightbox>("image-lightbox"), "image lightbox");
  await lightbox.updateComplete;
  const dialog = requiredElement(lightbox.shadowRoot?.querySelector<HTMLDialogElement>("dialog"), "image zoom dialog");
  expect(dialog.open).toBe(true);
  return requiredElement(dialog.querySelector<HTMLElement>(".close"), "image zoom close button");
}

async function openUploadReview(app: PiWebApp): Promise<HTMLElement> {
  const selectedWorkspace = workspace();
  setAppState(app, {
    selectedWorkspace,
    workspaces: [selectedWorkspace],
    workspaceTool: "core:workspace.files",
  });
  // The workspace panel is rendered where it can be seen, so this needs a shell
  // wide enough to seat it rather than a stylesheet that hid it.
  Object.defineProperty(app, "clientWidth", { configurable: true, value: 1440 });
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

function newSessionComposerRequest(app: PiWebApp): unknown {
  const state: unknown = Reflect.get(app, "state");
  if (typeof state !== "object" || state === null || !("newSessionComposer" in state)) throw new Error("New session composer request was unavailable");
  return state.newSessionComposer;
}

function newSessionComposerIsOpen(app: PiWebApp): boolean {
  const request = newSessionComposerRequest(app);
  return typeof request === "object" && request !== null && "kind" in request && request.kind === "open";
}

function setAppState(app: PiWebApp, patch: Partial<AppState>): void {
  if (!Reflect.set(app, "state", { ...initialAppState(), ...patch })) throw new Error("Could not set PiWebApp state");
}

function appSessionController(app: PiWebApp): SessionController {
  const controller: unknown = Reflect.get(app, "sessions");
  if (!(controller instanceof SessionController)) throw new Error("PiWebApp SessionController was unavailable");
  return controller;
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
