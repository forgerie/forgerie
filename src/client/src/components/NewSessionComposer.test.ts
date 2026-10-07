// @vitest-environment happy-dom

import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, workspacesApi, type Machine, type Project, type Workspace } from "../api";
import type { ComposerDictationCapability } from "../composerCapabilities";
import type { NewSessionDestinationCatalog, NewSessionLaunchIntent, NewSessionSubmissionOutcome } from "../newSessionComposer";
import { InMemoryNewSessionDestinationCatalog, completeNewSessionDestination } from "../newSessionComposer";
import { PromptEditor } from "./PromptEditor";
import { ComposerDraft } from "./ComposerDraft";
import type { AutocompleteMenu } from "./AutocompleteMenu";
import { NewSessionComposer } from "./NewSessionComposer";
import { deepActiveElement, dialogSection, dialogSurface, pressKey, settleRenderedDialog, surfaceBackdrop } from "./modalSurfaceTestSupport";
import { newSessionComposerStyles } from "./shared";

const machine = (id: string, status: Machine["status"] = "online"): Machine => ({
  id,
  name: id === "local" ? "This machine" : `Machine ${id}`,
  kind: id === "local" ? "local" : "remote",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  status,
});
const project = (id: string): Project => ({ id, name: `Project ${id}`, path: `/repos/${id}`, createdAt: "2026-08-10T00:00:00.000Z" });
const workspace = (id: string, projectId: string): Workspace => ({ id, projectId, path: `/repos/${projectId}/${id}`, label: id, isMain: id === "main", isGitRepo: true, isGitWorktree: id !== "main", effectiveConfig: {} });

async function mountComposer(options: {
  initialDestination?: NewSessionComposer["initialDestination"];
  initialPrompt?: string;
  catalog?: NewSessionDestinationCatalog;
  onCancel?: () => void;
  onSubmit?: NewSessionComposer["onSubmit"];
  onReturnRecoveryDraft?: NewSessionComposer["onReturnRecoveryDraft"];
  promptResourceCatalog?: NewSessionComposer["promptResourceCatalog"];
  dictation?: ComposerDictationCapability;
} = {}): Promise<NewSessionComposer> {
  const composer = new NewSessionComposer();
  if (options.initialDestination !== undefined) composer.initialDestination = options.initialDestination;
  if (options.catalog !== undefined) composer.catalog = options.catalog;
  if (options.onCancel !== undefined) composer.onCancel = options.onCancel;
  if (options.onSubmit !== undefined) composer.onSubmit = options.onSubmit;
  if (options.onReturnRecoveryDraft !== undefined) composer.onReturnRecoveryDraft = options.onReturnRecoveryDraft;
  if (options.promptResourceCatalog !== undefined) composer.promptResourceCatalog = options.promptResourceCatalog;
  if (options.dictation !== undefined) composer.dictation = options.dictation;
  document.body.append(composer);
  await settleRenderedDialog(composer);
  if (options.initialPrompt !== undefined) {
    await enterPrompt(composer, options.initialPrompt);
  }
  return composer;
}

function root(composer: NewSessionComposer): ShadowRoot {
  if (composer.shadowRoot === null) throw new Error("NewSessionComposer did not render a shadow root");
  return composer.shadowRoot;
}

function button(composer: NewSessionComposer, selector: string): HTMLButtonElement {
  const element = root(composer).querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Expected button ${selector}`);
  return element;
}

function promptEditor(composer: NewSessionComposer): PromptEditor {
  const element = root(composer).querySelector("prompt-editor");
  if (!(element instanceof PromptEditor)) throw new Error("Expected the shared composer");
  return element;
}

function draft(composer: NewSessionComposer): ComposerDraft {
  const element = promptEditor(composer).draft;
  if (!(element instanceof ComposerDraft)) throw new Error("Expected shared composer draft");
  return element;
}

/** The destination states itself in the composer row and carries its action. */
function destinationAction(composer: NewSessionComposer): HTMLButtonElement {
  const element = promptEditor(composer).shadowRoot?.querySelector("[data-action='change-destination']");
  if (!(element instanceof HTMLButtonElement)) throw new Error("Expected the destination action");
  return element;
}

function destinationChip(composer: NewSessionComposer): HTMLElement {
  const element = promptEditor(composer).shadowRoot?.querySelector(".composer-context-chip");
  if (!(element instanceof HTMLElement)) throw new Error("Expected the destination chip");
  return element;
}

/** The way out lives beside the way in, inside the composer. */
function cancelButton(composer: NewSessionComposer): HTMLButtonElement {
  const element = promptEditor(composer).shadowRoot?.querySelector(".composer-dismiss");
  if (!(element instanceof HTMLButtonElement)) throw new Error("Expected the composer cancel button");
  return element;
}

/** The modal sends through the composer's own send, not a dialog button. */
function sendButton(composer: NewSessionComposer): HTMLButtonElement {
  const element = promptEditor(composer).shadowRoot?.querySelector(".send-button");
  if (!(element instanceof HTMLButtonElement)) throw new Error("Expected the composer send button");
  return element;
}

function rapidfireToggle(composer: NewSessionComposer): HTMLButtonElement {
  const element = promptEditor(composer).shadowRoot?.querySelector("button[data-action='rapidfire']");
  if (!(element instanceof HTMLButtonElement)) throw new Error("Expected the Rapidfire toggle");
  return element;
}

function promptField(composer: NewSessionComposer): HTMLElement {
  const content = draft(composer).view?.contentDOM;
  if (content === undefined) throw new Error("Expected CodeMirror prompt field");
  return content;
}

function promptText(composer: NewSessionComposer): string {
  return draft(composer).view?.state.doc.toString() ?? "";
}

async function enterPrompt(composer: NewSessionComposer, value: string): Promise<void> {
  setEditorText(composer, value);
  await composer.updateComplete;
  await promptEditor(composer).updateComplete;
}

function setEditorText(composer: NewSessionComposer, text: string): void {
  const view = draft(composer).view;
  if (view === undefined) throw new Error("Expected CodeMirror to mount");
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(text.length) });
}

function menu(composer: NewSessionComposer): AutocompleteMenu | null | undefined {
  return draft(composer).querySelector<AutocompleteMenu>("autocomplete-menu");
}

async function waitForMenuItems(composer: NewSessionComposer, count: number): Promise<void> {
  const found = menu(composer);
  if (found === null || found === undefined) throw new Error("Expected autocomplete menu");
  await vi.waitFor(() => { expect(found.items).toHaveLength(count); });
  await found.updateComplete;
}

async function waitForSendEnabled(composer: NewSessionComposer): Promise<void> {
  await composer.updateComplete;
  await promptEditor(composer).updateComplete;
  await vi.waitFor(() => { expect(sendButton(composer).disabled).toBe(false); });
}

function pressPrompt(composer: NewSessionComposer, key: string): void {
  pressKey(promptField(composer), key);
}

async function attachFile(composer: NewSessionComposer, file: File): Promise<void> {
  const input = draft(composer).querySelector<HTMLInputElement>(".attachment-input");
  if (input === null) throw new Error("Expected attachment input");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change"));
  await vi.waitFor(() => { expect(draft(composer).querySelector(".attachment-chip")).not.toBeNull(); });
  await composer.updateComplete;
}

async function settleCatalog(composer: NewSessionComposer): Promise<void> {
  await Promise.resolve();
  await composer.updateComplete;
  await Promise.resolve();
  await composer.updateComplete;
}

function deferredPromptResourceCatalog(): {
  promise: Promise<Awaited<ReturnType<NewSessionComposer["promptResourceCatalog"]>>>;
  resolve: (value: Awaited<ReturnType<NewSessionComposer["promptResourceCatalog"]>>) => void;
} {
  let resolve!: (value: Awaited<ReturnType<NewSessionComposer["promptResourceCatalog"]>>) => void;
  const promise = new Promise<Awaited<ReturnType<NewSessionComposer["promptResourceCatalog"]>>>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

function fakeDictationCapability(): ComposerDictationCapability {
  return {
    getStatus: () => Promise.resolve({
      smartTurn: "ready",
      whisper: "ready",
      capability: "ready",
      limits: { sampleRateHz: 16_000, maxTurnSeconds: 60, maxTurnBytes: 3_840_000, endpointWindowSeconds: 8, endpointWindowBytes: 512_000 },
    }),
    createCaptureSession: () => Promise.reject(new Error("Capture is not used by this test.")),
    speechApi: {
      checkTurn: () => Promise.resolve({ complete: true, probability: 1, samples: 1 }),
      transcribe: () => Promise.resolve({ text: "new session dictation" }),
    },
  };
}

describe("new-session-composer editing and submission", () => {
  it("exposes host dictation before a session exists and scopes ownership to the destination", async () => {
    const dictation = fakeDictationCapability();
    const destination = completeNewSessionDestination(machine("remote-a"), project("project-a"), workspace("branch-a", "project-a"));
    const composer = await mountComposer({ initialDestination: destination, dictation });

    const editor = promptEditor(composer);
    expect(editor.capabilities.dictation).toBe(dictation);
    expect(editor.shadowRoot?.querySelector(".dictation-button")).not.toBeNull();
    expect(editor.machineId).toBe("remote-a");
    expect(editor.cwd).toBe("/repos/project-a/branch-a");
    expect(editor.projectId).toBe("project-a");
    expect(editor.workspaceId).toBe("branch-a");
  });

  it("focuses a complete default's prompt and refuses to launch an empty draft", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const onSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const composer = await mountComposer({ initialDestination: destination, onSubmit });
    const send = sendButton(composer);

    expect(dialogSection(composer).getAttribute("aria-label")).toBe("New session");
    expect(deepActiveElement()).toBe(promptField(composer));

    // The modal shows the chat composer itself, so send stays available and an
    // empty or blank draft simply does not launch a session.
    send.click();
    await settleCatalog(composer);
    expect(onSubmit).not.toHaveBeenCalled();

    await enterPrompt(composer, "   ");
    send.click();
    await settleCatalog(composer);
    expect(onSubmit).not.toHaveBeenCalled();

    await enterPrompt(composer, "Start the review");
    send.click();
    await settleCatalog(composer);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits the exact prompt and destination, then remains busy until the root accepts and unmounts it", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    let resolveSubmission: ((outcome: NewSessionSubmissionOutcome) => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<NewSessionSubmissionOutcome>((resolve) => { resolveSubmission = resolve; }));
    const onCancel = vi.fn<() => void>();
    const composer = await mountComposer({ initialDestination: destination, initialPrompt: "  exact prompt  ", onSubmit, onCancel });

    sendButton(composer).click();
    await settleCatalog(composer);

    expect(onSubmit).toHaveBeenCalledWith({ mode: "switch", destination, firstPrompt: { text: "  exact prompt  " } });
    expect(dialogSurface(composer).busy).toBe(true);
    expect(cancelButton(composer).disabled).toBe(true);
    surfaceBackdrop(composer).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    expect(onCancel).not.toHaveBeenCalled();

    resolveSubmission?.({ kind: "accepted" });
    await settleCatalog(composer);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(dialogSurface(composer).busy).toBe(true);
    expect(draft(composer).disabled).toBe(true);
    expect(cancelButton(composer).disabled).toBe(true);
    expect(sendButton(composer).disabled).toBe(true);
    expect(root(composer).querySelector("[role='status']")?.textContent).toContain("Starting session");
  });

  it("keeps the first-prompt caret when Rapidfire is toggled by pointer", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination });
    const toggle = rapidfireToggle(composer);

    expect(deepActiveElement()).toBe(promptField(composer));

    const pointerDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerType: "mouse" });
    // Browsers focus a pressed button unless the pointerdown default is
    // cancelled. Model that default so this test catches pointer focus theft.
    if (toggle.dispatchEvent(pointerDown)) toggle.focus();
    toggle.click();
    await composer.updateComplete;

    expect(rapidfireToggle(composer).getAttribute("aria-pressed")).toBe("true");
    expect(deepActiveElement()).toBe(promptField(composer));
  });

  it("locks the destination while Rapidfire is active and restores it when Rapidfire turns off", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination });

    expect(destinationAction(composer).disabled).toBe(false);

    rapidfireToggle(composer).click();
    await composer.updateComplete;
    await promptEditor(composer).updateComplete;

    expect(destinationAction(composer).disabled).toBe(true);

    rapidfireToggle(composer).click();
    await composer.updateComplete;
    await promptEditor(composer).updateComplete;

    expect(destinationAction(composer).disabled).toBe(false);
  });

  it("keeps destination choice available when Rapidfire has no destination yet", async () => {
    const composer = await mountComposer();

    rapidfireToggle(composer).click();
    await composer.updateComplete;
    await promptEditor(composer).updateComplete;

    expect(rapidfireToggle(composer).getAttribute("aria-pressed")).toBe("true");
    expect(destinationAction(composer).disabled).toBe(false);
  });

  it("clears and refocuses an accepted Rapidfire prompt in the Send event", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const onSubmit = vi.fn((): NewSessionSubmissionOutcome => ({ kind: "accepted" }));
    const composer = await mountComposer({ initialDestination: destination, initialPrompt: "Launch immediately", onSubmit });
    rapidfireToggle(composer).click();
    await composer.updateComplete;
    const send = sendButton(composer);
    send.focus();

    send.click();

    expect(onSubmit).toHaveBeenCalledWith({ mode: "rapidfire", destination, firstPrompt: { text: "Launch immediately" } });
    expect(promptText(composer)).toBe("");
    expect(deepActiveElement()).toBe(promptField(composer));
  });

  it("waits for the nested prompt to become editable before restoring Rapidfire focus", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    let resolveSubmission: ((outcome: NewSessionSubmissionOutcome) => void) | undefined;
    const composer = await mountComposer({
      initialDestination: destination,
      onSubmit: () => new Promise<NewSessionSubmissionOutcome>((resolve) => { resolveSubmission = resolve; }),
    });
    rapidfireToggle(composer).click();
    await composer.updateComplete;
    await enterPrompt(composer, "Launch the review");

    const composerDraft = draft(composer);
    const focusInput = composerDraft.focusInput.bind(composerDraft);
    // happy-dom can focus a non-editable CodeMirror surface. Chromium cannot,
    // so model that browser boundary while testing the nested update timing.
    vi.spyOn(composerDraft, "focusInput").mockImplementation(() => promptField(composer).getAttribute("contenteditable") === "true" ? focusInput() : false);
    const send = sendButton(composer);
    send.focus();
    send.click();

    await vi.waitFor(() => { expect(composerDraft.disabled).toBe(true); });
    promptField(composer).blur();
    expect(deepActiveElement()).not.toBe(promptField(composer));

    resolveSubmission?.({ kind: "accepted" });
    await vi.waitFor(() => { expect(promptText(composer)).toBe(""); });
    await promptEditor(composer).updateComplete;
    await composerDraft.updateComplete;

    expect(composerDraft.disabled).toBe(false);
    expect(deepActiveElement()).toBe(promptField(composer));
  });

  it("keeps Rapidfire open, preserves its destination, and clears each accepted prompt for the next launch", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const onSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const composer = await mountComposer({ initialDestination: destination, onSubmit });
    const toggle = rapidfireToggle(composer);

    expect(toggle.getAttribute("aria-label")).toBe("Rapidfire for current workspace");
    expect(toggle.textContent.trim()).toBe("");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    toggle.click();
    await composer.updateComplete;
    expect(rapidfireToggle(composer).getAttribute("aria-label")).toBe("Rapidfire for current workspace");

    await enterPrompt(composer, "Launch the first review");
    sendButton(composer).click();

    await vi.waitFor(() => { expect(promptText(composer)).toBe(""); });
    expect(onSubmit).toHaveBeenLastCalledWith({ mode: "rapidfire", destination, firstPrompt: { text: "Launch the first review" } });
    expect(dialogSurface(composer).busy).toBe(false);
    expect(deepActiveElement()).toBe(promptField(composer));

    await enterPrompt(composer, "Launch the second review");
    sendButton(composer).click();

    await vi.waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(2); });
    expect(onSubmit).toHaveBeenLastCalledWith({ mode: "rapidfire", destination, firstPrompt: { text: "Launch the second review" } });
  });

  it("returns a root rejection to the same mounted draft and permits destination recovery", async () => {
    const destination = completeNewSessionDestination(machine("remote"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({
      initialDestination: destination,
      initialPrompt: "keep this",
      onSubmit: () => Promise.resolve({ kind: "rejected", reason: "destination-unavailable", message: "The selected workspace is no longer available." }),
    });

    sendButton(composer).click();
    await settleCatalog(composer);

    expect(promptText(composer)).toBe("keep this");
    expect(root(composer).querySelector("[role='alert']")?.textContent).toContain("no longer available");
    expect(destinationAction(composer).disabled).toBe(false);
    expect(dialogSurface(composer).busy).toBe(false);
  });

  it("turns a synchronous root submission failure into a recoverable editing error", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({
      initialDestination: destination,
      initialPrompt: "still here",
      onSubmit: () => { throw new Error("Navigation failed"); },
    });

    sendButton(composer).click();
    await settleCatalog(composer);

    expect(promptText(composer)).toBe("still here");
    expect(root(composer).querySelector("[role='alert']")?.textContent).toContain("Navigation failed");
    expect(dialogSurface(composer).busy).toBe(false);
  });

  it("prevalidates Rapidfire slash commands before Send, then clears in the Send event", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const identity = { source: "prompt" as const, name: "review", fingerprint: "a".repeat(64) };
    const validation = deferredPromptResourceCatalog();
    const onSubmit = vi.fn((): NewSessionSubmissionOutcome => ({ kind: "accepted" }));
    const composer = await mountComposer({
      initialDestination: destination,
      onSubmit,
      promptResourceCatalog: () => validation.promise,
    });
    rapidfireToggle(composer).click();
    await composer.updateComplete;

    await enterPrompt(composer, "/review now");
    await vi.waitFor(() => { expect(sendButton(composer).disabled).toBe(true); });

    validation.resolve({
      available: true,
      diagnostics: [],
      commands: [{ name: "review", source: "prompt", identity }],
    });
    await vi.waitFor(() => { expect(sendButton(composer).disabled).toBe(false); });
    const send = sendButton(composer);
    send.focus();

    send.click();

    expect(onSubmit).toHaveBeenCalledWith({ mode: "rapidfire", destination, firstPrompt: { text: "/review now", promptResourceCommandIdentity: identity } });
    expect(promptText(composer)).toBe("");
    expect(deepActiveElement()).toBe(promptField(composer));
  });

  it("refreshes slash-command identity between accepted Rapidfire prompts", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const identities = ["a", "b"].map((value) => ({ source: "prompt" as const, name: "review", fingerprint: value.repeat(64) }));
    let loads = 0;
    const promptResourceCatalog = vi.fn(() => {
      const identity = identities[loads];
      loads += 1;
      if (identity === undefined) throw new Error("Unexpected catalog load");
      return Promise.resolve({ available: true as const, diagnostics: [], commands: [{ name: "review", source: "prompt" as const, identity }] });
    });
    const onSubmit = vi.fn((): NewSessionSubmissionOutcome => ({ kind: "accepted" }));
    const composer = await mountComposer({ initialDestination: destination, onSubmit, promptResourceCatalog });
    rapidfireToggle(composer).click();
    await composer.updateComplete;

    await enterPrompt(composer, "/review first");
    await waitForSendEnabled(composer);
    sendButton(composer).click();
    expect(promptText(composer)).toBe("");

    await enterPrompt(composer, "/review second");
    await waitForSendEnabled(composer);
    sendButton(composer).click();

    expect(promptResourceCatalog).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenNthCalledWith(1, { mode: "rapidfire", destination, firstPrompt: { text: "/review first", promptResourceCommandIdentity: identities[0] } });
    expect(onSubmit).toHaveBeenNthCalledWith(2, { mode: "rapidfire", destination, firstPrompt: { text: "/review second", promptResourceCommandIdentity: identities[1] } });
  });

  it("refreshes slash-command identity after a rejected launch", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const identities = ["c", "d"].map((value) => ({ source: "prompt" as const, name: "review", fingerprint: value.repeat(64) }));
    let loads = 0;
    const promptResourceCatalog = vi.fn(() => {
      const identity = identities[loads];
      loads += 1;
      if (identity === undefined) throw new Error("Unexpected catalog load");
      return Promise.resolve({ available: true as const, diagnostics: [], commands: [{ name: "review", source: "prompt" as const, identity }] });
    });
    const onSubmit = vi.fn()
      .mockReturnValueOnce({ kind: "rejected", reason: "launch-rejected", message: "Queue unavailable" } satisfies NewSessionSubmissionOutcome)
      .mockReturnValueOnce({ kind: "accepted" } satisfies NewSessionSubmissionOutcome);
    const composer = await mountComposer({ initialDestination: destination, onSubmit, promptResourceCatalog });

    await enterPrompt(composer, "/review retry");
    await waitForSendEnabled(composer);
    sendButton(composer).click();
    await waitForSendEnabled(composer);
    sendButton(composer).click();

    expect(promptResourceCatalog).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenNthCalledWith(1, { mode: "switch", destination, firstPrompt: { text: "/review retry", promptResourceCommandIdentity: identities[0] } });
    expect(onSubmit).toHaveBeenNthCalledWith(2, { mode: "switch", destination, firstPrompt: { text: "/review retry", promptResourceCommandIdentity: identities[1] } });
  });

  it("uses the shared draft runtime for prompt-resource and file completions, then sends the validated command identity", async () => {
    const destination = completeNewSessionDestination(machine("remote"), project("forge"), workspace("main", "forge"));
    const identity = { source: "prompt" as const, name: "review", fingerprint: "a".repeat(64) };
    vi.spyOn(workspacesApi, "promptResourceCatalog").mockResolvedValue({
      available: true,
      diagnostics: [],
      commands: [{ name: "review", source: "prompt", description: "Review <script>", identity }],
    });
    vi.spyOn(api, "files").mockResolvedValue([{ path: "src/app.ts", kind: "tracked" }]);
    const onSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const composer = await mountComposer({ initialDestination: destination, onSubmit });

    setEditorText(composer, "/re");
    await waitForMenuItems(composer, 1);
    expect(menu(composer)?.items[0]).toMatchObject({ insertText: "/review", description: "Review <script>" });
    expect(draft(composer).querySelector("script")).toBeNull();
    pressPrompt(composer, "Enter");
    await composer.updateComplete;
    expect(promptText(composer)).toBe("/review ");

    setEditorText(composer, "Read @src");
    await waitForMenuItems(composer, 1);
    expect(menu(composer)?.items[0]).toMatchObject({ insertText: "@src/app.ts" });

    setEditorText(composer, "/review now");
    await waitForSendEnabled(composer);
    sendButton(composer).click();
    await settleCatalog(composer);
    expect(onSubmit).toHaveBeenCalledWith({ mode: "switch", destination, firstPrompt: { text: "/review now", promptResourceCommandIdentity: identity } });
  });

  it("blocks unknown slash commands after validation without creating a session through footer or Enter", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    vi.spyOn(workspacesApi, "promptResourceCatalog").mockResolvedValue({ available: true, diagnostics: [], commands: [] });
    const onSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const composer = await mountComposer({ initialDestination: destination, initialPrompt: "/tree", onSubmit });

    await waitForSendEnabled(composer);
    sendButton(composer).click();
    await settleCatalog(composer);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(root(composer).querySelector("[role='alert']")?.textContent).toContain("/tree is not available");
    expect(sendButton(composer).disabled).toBe(true);

    pressPrompt(composer, "Enter");
    await settleCatalog(composer);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("drops a pending command catalog after the draft leaves slash mode", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const validations: ReturnType<typeof deferredPromptResourceCatalog>[] = [];
    const promptResourceCatalog = vi.fn(() => {
      const validation = deferredPromptResourceCatalog();
      validations.push(validation);
      return validation.promise;
    });
    const composer = await mountComposer({ initialDestination: destination, promptResourceCatalog });

    await enterPrompt(composer, "/review");
    await vi.waitFor(() => { expect(validations).toHaveLength(1); });
    await enterPrompt(composer, "plain text");
    validations[0]?.resolve({ available: false, reason: "error", message: "Stale catalog" });
    await settleCatalog(composer);
    await enterPrompt(composer, "/review");

    await vi.waitFor(() => { expect(validations).toHaveLength(2); });
  });

  it("ignores stale slash prevalidation after editing, destination change, or cancel", async () => {
    const firstDestination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const replacementDestination = completeNewSessionDestination(machine("remote"), project("other"), workspace("feature", "other"));
    const catalog = new InMemoryNewSessionDestinationCatalog({
      machines: [replacementDestination.machine],
      projectsByMachine: { remote: [replacementDestination.project] },
      workspacesByMachineAndProject: { "remote:other": [replacementDestination.workspace] },
    });
    const onSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));

    const editedValidation = deferredPromptResourceCatalog();
    const edited = await mountComposer({ initialDestination: firstDestination, onSubmit, promptResourceCatalog: () => editedValidation.promise });
    await enterPrompt(edited, "/review");
    await vi.waitFor(() => { expect(sendButton(edited).disabled).toBe(true); });
    await enterPrompt(edited, "plain replacement");
    editedValidation.resolve({ available: false, reason: "error", message: "Stale edit error" });
    await settleCatalog(edited);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(root(edited).querySelector("[role='alert']")).toBeNull();
    expect(promptText(edited)).toBe("plain replacement");

    document.body.replaceChildren();
    const destinationValidation = deferredPromptResourceCatalog();
    const destinationComposer = await mountComposer({
      initialDestination: firstDestination,
      catalog,
      onSubmit,
      promptResourceCatalog: () => destinationValidation.promise,
    });
    await enterPrompt(destinationComposer, "/review");
    await vi.waitFor(() => { expect(sendButton(destinationComposer).disabled).toBe(true); });
    destinationAction(destinationComposer).click();
    await settleCatalog(destinationComposer);
    button(destinationComposer, "[data-machine-id='remote']").click();
    await settleCatalog(destinationComposer);
    button(destinationComposer, "[data-project-id='other']").click();
    await settleCatalog(destinationComposer);
    button(destinationComposer, "[data-workspace-id='feature']").click();
    await destinationComposer.updateComplete;
    destinationValidation.resolve({ available: false, reason: "error", message: "Stale destination error" });
    await settleCatalog(destinationComposer);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(root(destinationComposer).querySelector("[role='alert']")).toBeNull();

    document.body.replaceChildren();
    const cancelValidation = deferredPromptResourceCatalog();
    const onCancel = vi.fn<() => void>();
    const cancelled = await mountComposer({ initialDestination: firstDestination, onSubmit, onCancel, promptResourceCatalog: () => cancelValidation.promise });
    await enterPrompt(cancelled, "/review");
    await vi.waitFor(() => { expect(sendButton(cancelled).disabled).toBe(true); });
    cancelButton(cancelled).click();
    cancelValidation.resolve({
      available: true,
      diagnostics: [],
      commands: [{ name: "review", source: "prompt", identity: { source: "prompt", name: "review", fingerprint: "c".repeat(64) } }],
    });
    await settleCatalog(cancelled);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("retries transient slash validation and blocks missing or ambiguous command names", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const identity = { source: "prompt" as const, name: "review", fingerprint: "d".repeat(64) };
    let loads = 0;
    const onSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const composer = await mountComposer({
      initialDestination: destination,
      initialPrompt: "/review",
      onSubmit,
      promptResourceCatalog: () => {
        loads += 1;
        if (loads === 1) return Promise.reject(new Error("Catalog offline"));
        return Promise.resolve({ available: true, diagnostics: [], commands: [{ name: "review", source: "prompt", identity }] });
      },
    });

    await waitForSendEnabled(composer);
    sendButton(composer).click();
    await settleCatalog(composer);
    button(composer, "[data-action='retry-prompt-resource-validation']").click();
    await vi.waitFor(() => { expect(onSubmit).toHaveBeenCalledWith({ mode: "switch", destination, firstPrompt: { text: "/review", promptResourceCommandIdentity: identity } }); });

    document.body.replaceChildren();
    const missingName = await mountComposer({ initialDestination: destination, initialPrompt: "/", onSubmit });
    sendButton(missingName).click();
    await settleCatalog(missingName);
    expect(root(missingName).querySelector("[role='alert']")?.textContent).toContain("name after /");

    document.body.replaceChildren();
    const ambiguous = await mountComposer({
      initialDestination: destination,
      initialPrompt: "/review",
      onSubmit,
      promptResourceCatalog: () => Promise.resolve({
        available: true,
        diagnostics: [],
        commands: [
          { name: "review", source: "prompt", identity },
          { name: "review", source: "skill", identity: { source: "skill", name: "review", fingerprint: "e".repeat(64) } },
        ],
      }),
    });
    await waitForSendEnabled(ambiguous);
    sendButton(ambiguous).click();
    await settleCatalog(ambiguous);
    expect(root(ambiguous).querySelector("[role='alert']")?.textContent).toContain("ambiguous");
  });

  it("cancels Retry auto-submit when the command draft changes", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const identity = { source: "prompt" as const, name: "review", fingerprint: "f".repeat(64) };
    const retryValidation = deferredPromptResourceCatalog();
    let loads = 0;
    const onSubmit = vi.fn((): NewSessionSubmissionOutcome => ({ kind: "accepted" }));
    const composer = await mountComposer({
      initialDestination: destination,
      initialPrompt: "/review original",
      onSubmit,
      promptResourceCatalog: () => {
        loads += 1;
        return loads === 1 ? Promise.reject(new Error("Catalog offline")) : retryValidation.promise;
      },
    });
    await waitForSendEnabled(composer);
    sendButton(composer).click();
    await settleCatalog(composer);
    button(composer, "[data-action='retry-prompt-resource-validation']").click();
    await vi.waitFor(() => { expect(loads).toBe(2); });

    await enterPrompt(composer, "/review edited");
    retryValidation.resolve({ available: true, diagnostics: [], commands: [{ name: "review", source: "prompt", identity }] });
    await waitForSendEnabled(composer);

    expect(onSubmit).not.toHaveBeenCalled();
    sendButton(composer).click();
    expect(onSubmit).toHaveBeenCalledWith({ mode: "switch", destination, firstPrompt: { text: "/review edited", promptResourceCommandIdentity: identity } });
  });

  it("lets plain text and attachment-only launches proceed when the prompt-resource catalog fails", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    vi.spyOn(workspacesApi, "promptResourceCatalog").mockRejectedValue(new Error("Catalog offline"));

    const textSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const textComposer = await mountComposer({ initialDestination: destination, initialPrompt: "plain text", onSubmit: textSubmit });
    sendButton(textComposer).click();
    await settleCatalog(textComposer);
    expect(textSubmit).toHaveBeenCalledWith({ mode: "switch", destination, firstPrompt: { text: "plain text" } });

    document.body.replaceChildren();
    const attachmentSubmit = vi.fn((intent: NewSessionLaunchIntent): Promise<NewSessionSubmissionOutcome> => {
      expect(intent.destination).toEqual(destination);
      return Promise.resolve({ kind: "accepted" });
    });
    const attachmentComposer = await mountComposer({ initialDestination: destination, onSubmit: attachmentSubmit });
    await attachFile(attachmentComposer, new File(["hello"], "note.txt", { type: "text/plain" }));
    sendButton(attachmentComposer).click();
    await settleCatalog(attachmentComposer);
    expect(attachmentSubmit.mock.calls[0]?.[0].firstPrompt).toMatchObject({ text: "", attachments: [{ name: "note.txt", mimeType: "text/plain" }], delivery: "folder" });

    document.body.replaceChildren();
    const slashSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const slashComposer = await mountComposer({ initialDestination: destination, initialPrompt: "/review", onSubmit: slashSubmit });
    await waitForSendEnabled(slashComposer);
    sendButton(slashComposer).click();
    await settleCatalog(slashComposer);
    expect(slashSubmit).not.toHaveBeenCalled();
    expect(root(slashComposer).querySelector("[data-action='retry-prompt-resource-validation']")?.textContent).toBe("Retry");
  });
});

describe("new-session-composer destination choice", () => {
  it("says a destination is needed in words that open the chooser", async () => {
    const catalog = new InMemoryNewSessionDestinationCatalog({ machines: [machine("remote")] });
    const composer = await mountComposer({ catalog });

    // The required state must read as a choice, not as an unlabelled pencil:
    // on a folded phone the words are the only sign a destination is missing.
    expect(destinationChip(composer).textContent.trim()).toBe("Choose destination");
    expect(destinationAction(composer).getAttribute("aria-label")).toBe("Choose destination");

    destinationAction(composer).click();
    await settleCatalog(composer);

    expect(root(composer).querySelector("[data-machine-id='remote']")).not.toBeNull();
  });

  it("does not let Rapidfire activate while the destination chooser is open", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const catalog = new InMemoryNewSessionDestinationCatalog({ machines: [machine("remote")] });
    const composer = await mountComposer({ initialDestination: destination, catalog });

    destinationAction(composer).click();
    await settleCatalog(composer);

    const rapidfire = rapidfireToggle(composer);
    expect(rapidfire.disabled).toBe(true);
    rapidfire.click();
    await composer.updateComplete;

    expect(rapidfireToggle(composer).getAttribute("aria-pressed")).toBe("false");
    expect(root(composer).querySelector("[data-machine-id='remote']")).not.toBeNull();
  });

  it("cancels dictation before each chooser destination transition", async () => {
    const catalog = new InMemoryNewSessionDestinationCatalog({
      machines: [machine("remote")],
      projectsByMachine: { remote: [project("forge")] },
      workspacesByMachineAndProject: { "remote:forge": [workspace("feature", "forge")] },
    });
    const composer = await mountComposer({ catalog, dictation: fakeDictationCapability() });
    const cancelDictation = vi.spyOn(promptEditor(composer), "cancelDictation");

    destinationAction(composer).click();
    await settleCatalog(composer);
    button(composer, "[data-machine-id='remote']").click();
    await settleCatalog(composer);
    button(composer, "[data-project-id='forge']").click();
    await settleCatalog(composer);
    button(composer, "[data-workspace-id='feature']").click();
    await composer.updateComplete;

    expect(cancelDictation).toHaveBeenCalledTimes(4);
  });

  it("requires a destination without a default and retains the prompt across a cross-machine choice", async () => {
    const catalog = new InMemoryNewSessionDestinationCatalog({
      machines: [machine("local"), machine("remote")],
      projectsByMachine: { remote: [project("forge")] },
      workspacesByMachineAndProject: { "remote:forge": [workspace("feature", "forge")] },
    });
    let submittedIntent: NewSessionLaunchIntent | undefined;
    const onSubmit = vi.fn((intent: NewSessionLaunchIntent): Promise<NewSessionSubmissionOutcome> => {
      submittedIntent = intent;
      return Promise.resolve({ kind: "accepted" });
    });
    const composer = await mountComposer({ initialPrompt: "draft survives", catalog, onSubmit });

    expect(deepActiveElement()).toBe(promptField(composer));
    expect(sendButton(composer).disabled).toBe(true);

    destinationAction(composer).click();
    await settleCatalog(composer);
    button(composer, "[data-machine-id='remote']").click();
    await settleCatalog(composer);
    button(composer, "[data-project-id='forge']").click();
    await settleCatalog(composer);
    button(composer, "[data-workspace-id='feature']").click();
    await composer.updateComplete;

    expect(promptText(composer)).toBe("draft survives");
    expect(destinationChip(composer).textContent).toContain("Project forge");
    expect(destinationChip(composer).textContent).toContain("feature");
    expect(sendButton(composer).disabled).toBe(false);

    sendButton(composer).click();
    await composer.updateComplete;
    expect(onSubmit).toHaveBeenCalledOnce();
    if (submittedIntent === undefined) throw new Error("Expected a submitted launch intent");
    expect(submittedIntent.destination.machine.id).toBe("remote");
    expect(submittedIntent.destination.project.id).toBe("forge");
    expect(submittedIntent.destination.workspace.id).toBe("feature");
    expect(submittedIntent.firstPrompt.text).toBe("draft survives");
  });

  it("renders stage-specific loading, empty, error, refresh, and Back actions", async () => {
    let machineLoads = 0;
    let projectLoads = 0;
    let resolveMachineLoad: ((machines: readonly Machine[]) => void) | undefined;
    const catalog: NewSessionDestinationCatalog = {
      loadMachines: () => {
        machineLoads += 1;
        if (machineLoads === 1) return new Promise((resolve) => { resolveMachineLoad = resolve; });
        return Promise.resolve([machine("remote")]);
      },
      loadProjects: () => {
        projectLoads += 1;
        return projectLoads === 1 ? Promise.reject(new Error("Projects could not load")) : Promise.resolve([]);
      },
      loadWorkspaces: () => Promise.resolve([]),
    };
    const composer = await mountComposer({ initialPrompt: "preserved", catalog });

    destinationAction(composer).click();
    await composer.updateComplete;
    expect(root(composer).querySelector("[data-state='machine-loading']")).not.toBeNull();
    resolveMachineLoad?.([]);
    await settleCatalog(composer);
    expect(root(composer).querySelector("[data-state='machine-empty']")?.textContent).toContain("No machines");
    button(composer, "[data-action='refresh-machines']").click();
    await settleCatalog(composer);
    button(composer, "[data-machine-id='remote']").click();
    await settleCatalog(composer);

    expect(root(composer).querySelector("[data-state='project-error']")?.textContent).toContain("Projects could not load");
    expect(button(composer, "[data-action='back-machine']")).not.toBeNull();
    button(composer, "[data-action='refresh-projects']").click();
    await settleCatalog(composer);
    expect(root(composer).querySelector("[data-state='project-empty']")?.textContent).toContain("No projects");
    expect(promptText(composer)).toBe("preserved");
  });

  it("keeps unavailable machines visible and Refresh permits selection when one returns online", async () => {
    let machineLoads = 0;
    const catalog: NewSessionDestinationCatalog = {
      loadMachines: () => {
        machineLoads += 1;
        return Promise.resolve(machineLoads === 1
          ? [machine("offline", "offline"), machine("failed", "error")]
          : [machine("offline", "online"), machine("failed", "error")]);
      },
      loadProjects: () => Promise.resolve([project("forge")]),
      loadWorkspaces: () => Promise.resolve([workspace("main", "forge")]),
    };
    const onSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const composer = await mountComposer({ initialPrompt: "keep this prompt", catalog, onSubmit });

    destinationAction(composer).click();
    await settleCatalog(composer);

    expect(root(composer).querySelector("[data-state='machine-unavailable'][role='status']")?.textContent).toContain("No machines are currently available");
    expect(button(composer, "[data-machine-id='offline']").disabled).toBe(true);
    expect(button(composer, "[data-machine-id='failed']").disabled).toBe(true);
    expect(promptText(composer)).toBe("keep this prompt");
    expect(sendButton(composer).disabled).toBe(true);

    button(composer, "[data-action='refresh-machines']").click();
    await settleCatalog(composer);
    expect(button(composer, "[data-machine-id='offline']").disabled).toBe(false);

    button(composer, "[data-machine-id='offline']").click();
    await settleCatalog(composer);
    button(composer, "[data-project-id='forge']").click();
    await settleCatalog(composer);
    button(composer, "[data-workspace-id='main']").click();
    await composer.updateComplete;

    expect(promptText(composer)).toBe("keep this prompt");
    expect(sendButton(composer).disabled).toBe(false);
    sendButton(composer).click();
    await composer.updateComplete;
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("recovers from a rejected workspace catalog with Refresh and Back without losing the prompt", async () => {
    let workspaceLoads = 0;
    const catalog: NewSessionDestinationCatalog = {
      loadMachines: () => Promise.resolve([machine("remote")]),
      loadProjects: () => Promise.resolve([project("forge")]),
      loadWorkspaces: () => {
        workspaceLoads += 1;
        return workspaceLoads === 1 ? Promise.reject(new Error("Workspaces could not load")) : Promise.resolve([]);
      },
    };
    const composer = await mountComposer({ initialPrompt: "keep me", catalog });

    destinationAction(composer).click();
    await settleCatalog(composer);
    button(composer, "[data-machine-id='remote']").click();
    await settleCatalog(composer);
    button(composer, "[data-project-id='forge']").click();
    await settleCatalog(composer);

    expect(root(composer).querySelector("[data-state='workspace-error']")?.textContent).toContain("Workspaces could not load");
    button(composer, "[data-action='refresh-workspaces']").click();
    await settleCatalog(composer);
    expect(root(composer).querySelector("[data-state='workspace-empty']")?.textContent).toContain("No workspaces");

    button(composer, "[data-action='back-project']").click();
    await settleCatalog(composer);
    expect(root(composer).querySelector("[data-project-id='forge']")).not.toBeNull();
    expect(promptText(composer)).toBe("keep me");
    expect(sendButton(composer).disabled).toBe(true);
  });

  it("runs Back from a project catalog and preserves the prompt", async () => {
    const catalog = new InMemoryNewSessionDestinationCatalog({
      machines: [machine("remote")],
      projectsByMachine: { remote: [] },
    });
    const composer = await mountComposer({ initialPrompt: "project draft", catalog });

    destinationAction(composer).click();
    await settleCatalog(composer);
    button(composer, "[data-machine-id='remote']").click();
    await settleCatalog(composer);
    button(composer, "[data-action='back-machine']").click();
    await settleCatalog(composer);

    expect(root(composer).querySelector("[data-machine-id='remote']")).not.toBeNull();
    expect(promptText(composer)).toBe("project draft");
  });

  it("settles the active machine request after rapid repeated Change machine", async () => {
    let machineLoads = 0;
    let resolveBackMachines: ((machines: readonly Machine[]) => void) | undefined;
    const catalog: NewSessionDestinationCatalog = {
      loadMachines: () => {
        machineLoads += 1;
        return machineLoads === 1
          ? Promise.resolve([machine("remote")])
          : new Promise((resolve) => { resolveBackMachines = resolve; });
      },
      loadProjects: () => new Promise(() => undefined),
      loadWorkspaces: () => Promise.resolve([]),
    };
    const composer = await mountComposer({ initialPrompt: "rapid draft", catalog });

    destinationAction(composer).click();
    await settleCatalog(composer);
    button(composer, "[data-machine-id='remote']").click();
    await composer.updateComplete;
    const changeMachine = button(composer, "[data-action='back-machine']");
    changeMachine.click();
    changeMachine.click();
    resolveBackMachines?.([machine("current")]);
    await settleCatalog(composer);

    expect(machineLoads).toBe(2);
    expect(root(composer).querySelector("[data-machine-id='current']")).not.toBeNull();
    expect(root(composer).querySelector("[data-state='machine-loading']")).toBeNull();
    expect(promptText(composer)).toBe("rapid draft");
  });

  it("settles the active project request after rapid repeated Change project", async () => {
    let projectLoads = 0;
    let resolveBackProjects: ((projects: readonly Project[]) => void) | undefined;
    const catalog: NewSessionDestinationCatalog = {
      loadMachines: () => Promise.resolve([machine("remote")]),
      loadProjects: () => {
        projectLoads += 1;
        return projectLoads === 1
          ? Promise.resolve([project("forge")])
          : new Promise((resolve) => { resolveBackProjects = resolve; });
      },
      loadWorkspaces: () => new Promise(() => undefined),
    };
    const composer = await mountComposer({ initialPrompt: "workspace draft", catalog });

    destinationAction(composer).click();
    await settleCatalog(composer);
    button(composer, "[data-machine-id='remote']").click();
    await settleCatalog(composer);
    button(composer, "[data-project-id='forge']").click();
    await composer.updateComplete;
    const changeProject = button(composer, "[data-action='back-project']");
    changeProject.click();
    changeProject.click();
    resolveBackProjects?.([project("current")]);
    await settleCatalog(composer);

    expect(projectLoads).toBe(2);
    expect(root(composer).querySelector("[data-project-id='current']")).not.toBeNull();
    expect(root(composer).querySelector("[data-state='project-loading']")).toBeNull();
    expect(promptText(composer)).toBe("workspace draft");
  });

  it("ignores a stale machine result after Refresh starts a newer request", async () => {
    let resolveFirst: ((machines: readonly Machine[]) => void) | undefined;
    let loads = 0;
    const catalog: NewSessionDestinationCatalog = {
      loadMachines: () => {
        loads += 1;
        if (loads === 1) return new Promise((resolve) => { resolveFirst = resolve; });
        return Promise.resolve([machine("current")]);
      },
      loadProjects: () => Promise.resolve([]),
      loadWorkspaces: () => Promise.resolve([]),
    };
    const composer = await mountComposer({ catalog });

    destinationAction(composer).click();
    await composer.updateComplete;
    button(composer, "[data-action='refresh-machines-loading']").click();
    await settleCatalog(composer);
    resolveFirst?.([machine("stale")]);
    await settleCatalog(composer);

    expect(root(composer).querySelector("[data-machine-id='current']")).not.toBeNull();
    expect(root(composer).querySelector("[data-machine-id='stale']")).toBeNull();
  });
});

describe("new-session-composer presentation contracts", () => {
  it("lets the island be the only surface, with no dialog box around it", () => {
    const styles = newSessionComposerStyles.cssText.replaceAll(/\s+/g, " ");

    // A dialog box here would draw a second border, background, and shadow
    // around a composer that already carries all three.
    expect(styles).toContain("--modal-surface-background: transparent");
    expect(styles).toContain("--modal-surface-border: none");
    expect(styles).toContain("--modal-surface-shadow: none");
  });

  it("keeps the accessible modal name without a visible duplicate titlebar or close action", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination });

    expect(dialogSection(composer).getAttribute("aria-label")).toBe("New session");
    expect(root(composer).querySelector(".dialog-header, h1, [data-action='close']")).toBeNull();
  });

  it("states one concise destination in the composer row, without a main branch, status, or path detail", async () => {
    const destination = completeNewSessionDestination(machine("remote"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination });
    const chip = destinationChip(composer);

    expect(chip.textContent.replaceAll(/\s+/g, " ").trim()).toBe("Project forge · Machine remote");
    expect(chip.textContent).not.toContain("main");
    expect(chip.textContent).not.toContain("Change");
    expect(chip.textContent).not.toContain("Online");
    expect(chip.textContent).not.toContain("/repos/forge/main");
    expect(destinationAction(composer).querySelector(".prompt-context-action-icon")).not.toBeNull();
  });

  it("omits the local machine from the destination summary", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination });

    expect(destinationChip(composer).textContent.replaceAll(/\s+/g, " ").trim()).toBe("Project forge");
  });

  it("keeps a non-main branch when omitting the local machine", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("feature", "forge"));
    const composer = await mountComposer({ initialDestination: destination });

    expect(destinationChip(composer).textContent.replaceAll(/\s+/g, " ").trim()).toBe("Project forge · feature");
  });

  it("keeps a non-main branch in the remote destination summary", async () => {
    const destination = completeNewSessionDestination(machine("remote"), project("forge"), workspace("feature", "forge"));
    const composer = await mountComposer({ initialDestination: destination });

    expect(destinationChip(composer).textContent.replaceAll(/\s+/g, " ").trim()).toBe("Project forge · feature · Machine remote");
  });

  it("uses semantic button lists, keeps the summary to one line, and lets chooser detail wrap", async () => {
    const catalog = new InMemoryNewSessionDestinationCatalog({
      machines: [machine("remote")],
      projectsByMachine: { remote: [project("forge")] },
      workspacesByMachineAndProject: { "remote:forge": [workspace("feature", "forge")] },
    });
    const composer = await mountComposer({ catalog });

    destinationAction(composer).click();
    await settleCatalog(composer);
    expect(root(composer).querySelectorAll("ul.catalog-list > li > button[data-machine-id]")).toHaveLength(1);
    expect(root(composer).querySelector("[role='listbox'], [role='option']")).toBeNull();

    button(composer, "[data-machine-id='remote']").click();
    await settleCatalog(composer);
    expect(root(composer).querySelectorAll("ul.catalog-list > li > button[data-project-id]")).toHaveLength(1);
    expect(root(composer).querySelector("[role='listbox'], [role='option']")).toBeNull();

    button(composer, "[data-project-id='forge']").click();
    await settleCatalog(composer);
    expect(root(composer).querySelectorAll("ul.catalog-list > li > button[data-workspace-id]")).toHaveLength(1);
    expect(root(composer).querySelector("[role='listbox'], [role='option']")).toBeNull();

    const styles = newSessionComposerStyles.cssText.replaceAll(/\s+/g, " ");
    expect(styles).toContain(".catalog-item-copy strong, .catalog-item-copy small { min-width: 0; overflow-wrap: anywhere; white-space: normal;");
  });

  it("hosts the shared draft rather than retaining textarea-specific prompt styling", () => {
    const styles = newSessionComposerStyles.cssText.replaceAll(/\s+/g, " ");

    expect(styles).toContain("composer-draft { display: block; min-width: 0;");
    expect(styles).not.toContain("textarea { box-sizing: border-box; width: 100%; min-height");
  });

  it("gives the shared composer the full transient surface as its completion boundary", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination });

    expect(promptEditor(composer).completionBoundary).toBe(composer);
  });
});

describe("new-session-composer modal lifetime", () => {
  it("Cancel, Escape, and backdrop close without submitting when not busy", async () => {
    const onCancel = vi.fn<() => void>();
    const onSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const composer = await mountComposer({ onCancel, onSubmit });

    cancelButton(composer).click();
    dialogSurface(composer).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, composed: true }));
    surfaceBackdrop(composer).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));

    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("claims an opaque recovery seed exactly once into the shared draft", async () => {
    const claim = vi.fn((id: string) => ({ id, snapshot: { text: "restored privately" } }));
    const composer = new NewSessionComposer();
    composer.recoverySeedId = "recovery-1";
    composer.onClaimRecoveryDraft = claim;
    document.body.append(composer);
    await settleRenderedDialog(composer);
    await composer.updateComplete;

    expect(claim).toHaveBeenCalledExactlyOnceWith("recovery-1");
    expect(promptText(composer)).toBe("restored privately");
    composer.requestUpdate();
    await composer.updateComplete;
    expect(claim).toHaveBeenCalledOnce();
  });

  it("prevalidates a restored slash-command recovery draft", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const identity = { source: "prompt" as const, name: "review", fingerprint: "a".repeat(64) };
    const validation = deferredPromptResourceCatalog();
    const onSubmit = vi.fn((): NewSessionSubmissionOutcome => ({ kind: "accepted" }));
    const composer = new NewSessionComposer();
    composer.initialDestination = destination;
    composer.recoverySeedId = "recovery-command";
    composer.onClaimRecoveryDraft = (id: string) => ({ id, snapshot: { text: "/review recovered" } });
    composer.promptResourceCatalog = () => validation.promise;
    composer.onSubmit = onSubmit;
    document.body.append(composer);
    await settleRenderedDialog(composer);
    await vi.waitFor(() => { expect(sendButton(composer).disabled).toBe(true); });

    validation.resolve({ available: true, diagnostics: [], commands: [{ name: "review", source: "prompt", identity }] });
    await waitForSendEnabled(composer);
    sendButton(composer).click();

    expect(onSubmit).toHaveBeenCalledWith({ mode: "switch", destination, firstPrompt: { text: "/review recovered", promptResourceCommandIdentity: identity } });
  });

  it("returns the current claimed recovery snapshot on cancel before discarding the draft", async () => {
    const attachment = { kind: "image" as const, mimeType: "image/png", data: "QUJD", name: "shot.png" };
    const returned = vi.fn<NonNullable<NewSessionComposer["onReturnRecoveryDraft"]>>();
    const composer = new NewSessionComposer();
    composer.recoverySeedId = "recovery-1";
    composer.onClaimRecoveryDraft = (id: string) => ({ id, snapshot: { text: "original", attachments: [attachment], delivery: "inline" } });
    composer.onReturnRecoveryDraft = returned;
    document.body.append(composer);
    await settleRenderedDialog(composer);
    await composer.updateComplete;

    await enterPrompt(composer, "edited");
    const snapshot = draft(composer).currentSnapshot();
    if (snapshot.attachments === undefined) throw new Error("Expected restored attachment");
    snapshot.attachments[0] = { ...attachment, data: "changed" };
    expect(draft(composer).currentSnapshot().attachments?.[0]?.data).toBe("QUJD");
    cancelButton(composer).click();

    expect(returned).toHaveBeenCalledExactlyOnceWith("recovery-1", { text: "edited", attachments: [attachment], delivery: "inline" });
  });

  it("returns a claimed recovery snapshot when the modal disconnects without cancel", async () => {
    const returned = vi.fn<NonNullable<NewSessionComposer["onReturnRecoveryDraft"]>>();
    const composer = new NewSessionComposer();
    composer.recoverySeedId = "recovery-1";
    composer.onClaimRecoveryDraft = (id: string) => ({ id, snapshot: { text: "still owned" } });
    composer.onReturnRecoveryDraft = returned;
    document.body.append(composer);
    await settleRenderedDialog(composer);
    await composer.updateComplete;

    composer.remove();

    await vi.waitFor(() => {
      expect(returned).toHaveBeenCalledExactlyOnceWith("recovery-1", { text: "still owned" });
    });
  });

  it("waits for pending attachment capture before returning a disconnected recovery draft", async () => {
    let resolveRead: (() => void) | undefined;
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      resolveRead = () => {
        Object.defineProperty(this, "result", { configurable: true, value: "data:image/png;base64,aW1hZ2U=" });
        this.dispatchEvent(new ProgressEvent("load"));
      };
    });
    const returned = vi.fn<NonNullable<NewSessionComposer["onReturnRecoveryDraft"]>>();
    const composer = new NewSessionComposer();
    composer.recoverySeedId = "recovery-1";
    composer.onClaimRecoveryDraft = (id: string) => ({ id, snapshot: { text: "still owned" } });
    composer.onReturnRecoveryDraft = returned;
    document.body.append(composer);
    await settleRenderedDialog(composer);
    await composer.updateComplete;

    const input = draft(composer).querySelector<HTMLInputElement>(".attachment-input");
    if (input === null) throw new Error("Expected attachment input");
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["image"], "shot.png", { type: "image/png" })] });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => { expect(cancelButton(composer).disabled).toBe(true); });
    composer.remove();
    await Promise.resolve();
    expect(returned).not.toHaveBeenCalled();

    if (resolveRead === undefined) throw new Error("Expected pending FileReader");
    resolveRead();

    await vi.waitFor(() => {
      expect(returned).toHaveBeenCalledWith("recovery-1", {
        text: "still owned",
        attachments: [{ kind: "image", mimeType: "image/png", data: "aW1hZ2U=", name: "shot.png" }],
        delivery: "inline",
      });
    });
  });

  it("does not return a claimed recovery draft after its replacement launch is accepted", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const returned = vi.fn<NonNullable<NewSessionComposer["onReturnRecoveryDraft"]>>();
    const submitted = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const composer = new NewSessionComposer();
    composer.initialDestination = destination;
    composer.recoverySeedId = "recovery-1";
    composer.onClaimRecoveryDraft = (id: string) => ({ id, snapshot: { text: "replace me" } });
    composer.onReturnRecoveryDraft = returned;
    composer.onSubmit = submitted;
    document.body.append(composer);
    await settleRenderedDialog(composer);
    await composer.updateComplete;

    sendButton(composer).click();
    await vi.waitFor(() => {
      expect(submitted).toHaveBeenCalledOnce();
      expect(draft(composer).currentSnapshot().text).toBe("");
    });
    composer.remove();
    await Promise.resolve();

    expect(returned).not.toHaveBeenCalled();
  });

  it("returns only draft-owned fields when a claimed recovery rolls back", async () => {
    const returned = vi.fn<NonNullable<NewSessionComposer["onReturnRecoveryDraft"]>>();
    const composer = new NewSessionComposer();
    composer.recoverySeedId = "recovery-1";
    composer.onClaimRecoveryDraft = (id: string) => ({ id, snapshot: { text: "/review src", delivery: "inline" } });
    composer.onReturnRecoveryDraft = returned;
    document.body.append(composer);
    await settleRenderedDialog(composer);
    await composer.updateComplete;

    cancelButton(composer).click();

    expect(returned).toHaveBeenCalledExactlyOnceWith("recovery-1", { text: "/review src" });
  });

  it("focusExisting returns focus to the same draft without reinitializing it", async () => {
    const composer = await mountComposer({ initialPrompt: "original" });
    await enterPrompt(composer, "edited locally");
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    composer.focusExisting();

    expect(deepActiveElement()).toBe(promptField(composer));
    expect(promptText(composer)).toBe("edited locally");
  });

  it("restarts slash-command prevalidation after reconnecting the same composer", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const identity = { source: "prompt" as const, name: "review", fingerprint: "a".repeat(64) };
    const promptResourceCatalog = vi.fn(() => Promise.resolve({
      available: true as const,
      diagnostics: [],
      commands: [{ name: "review", source: "prompt" as const, identity }],
    }));
    const composer = await mountComposer({ initialDestination: destination, promptResourceCatalog });
    await enterPrompt(composer, "/review reconnect");
    await waitForSendEnabled(composer);
    expect(promptResourceCatalog).toHaveBeenCalledOnce();

    composer.remove();
    document.body.append(composer);
    await settleRenderedDialog(composer);
    await waitForSendEnabled(composer);

    expect(promptResourceCatalog).toHaveBeenCalledTimes(2);
    expect(promptText(composer)).toBe("/review reconnect");
  });

  it("preserves the local prompt and destination across ordinary responsive rerenders", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination, initialPrompt: "before" });
    await enterPrompt(composer, "after resize");

        composer.requestUpdate();
    await composer.updateComplete;

    expect(promptText(composer)).toBe("after resize");
    expect(destinationChip(composer).textContent).toContain("Project forge");
  });
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});
