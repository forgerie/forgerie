// @vitest-environment happy-dom

import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, workspacesApi, type Machine, type Project, type Workspace } from "../api";
import type { PromptResourceCommandIdentity } from "../../../shared/promptResourceCommand";
import type { NewSessionDestinationCatalog, NewSessionLaunchIntent, NewSessionSubmissionOutcome } from "../newSessionComposer";
import { InMemoryNewSessionDestinationCatalog, completeNewSessionDestination } from "../newSessionComposer";
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
} = {}): Promise<NewSessionComposer> {
  const composer = new NewSessionComposer();
  if (options.initialDestination !== undefined) composer.initialDestination = options.initialDestination;
  if (options.catalog !== undefined) composer.catalog = options.catalog;
  if (options.onCancel !== undefined) composer.onCancel = options.onCancel;
  if (options.onSubmit !== undefined) composer.onSubmit = options.onSubmit;
  if (options.onReturnRecoveryDraft !== undefined) composer.onReturnRecoveryDraft = options.onReturnRecoveryDraft;
  if (options.promptResourceCatalog !== undefined) composer.promptResourceCatalog = options.promptResourceCatalog;
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

function draft(composer: NewSessionComposer): ComposerDraft {
  const element = root(composer).querySelector("composer-draft");
  if (!(element instanceof ComposerDraft)) throw new Error("Expected shared composer draft");
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
  draft(composer).replaceText(value);
  await composer.updateComplete;
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

describe("new-session-composer editing and submission", () => {
  it("focuses a complete default's prompt and enables Send only for non-empty text", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination });
    const send = button(composer, "[data-action='send']");

    expect(dialogSection(composer).getAttribute("aria-label")).toBe("New session");
    expect(deepActiveElement()).toBe(draft(composer));
    expect(send.disabled).toBe(true);

    await enterPrompt(composer, "   ");
    expect(send.disabled).toBe(true);
    await enterPrompt(composer, "Start the review");
    expect(send.disabled).toBe(false);
  });

  it("submits the exact prompt and destination, then remains busy until the root accepts and unmounts it", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    let resolveSubmission: ((outcome: NewSessionSubmissionOutcome) => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<NewSessionSubmissionOutcome>((resolve) => { resolveSubmission = resolve; }));
    const onCancel = vi.fn<() => void>();
    const composer = await mountComposer({ initialDestination: destination, initialPrompt: "  exact prompt  ", onSubmit, onCancel });

    button(composer, "[data-action='send']").click();
    await settleCatalog(composer);

    expect(onSubmit).toHaveBeenCalledWith({ destination, firstPrompt: { text: "  exact prompt  " } });
    expect(dialogSurface(composer).busy).toBe(true);
    expect(button(composer, "[data-action='cancel']").disabled).toBe(true);
    surfaceBackdrop(composer).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    expect(onCancel).not.toHaveBeenCalled();

    resolveSubmission?.({ kind: "accepted" });
    await settleCatalog(composer);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(dialogSurface(composer).busy).toBe(true);
    expect(draft(composer).disabled).toBe(true);
    expect(button(composer, "[data-action='cancel']").disabled).toBe(true);
    expect(button(composer, "[data-action='send']").disabled).toBe(true);
    expect(root(composer).querySelector("[role='status']")?.textContent).toContain("Checking destination");
  });

  it("returns a root rejection to the same mounted draft and permits destination recovery", async () => {
    const destination = completeNewSessionDestination(machine("remote"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({
      initialDestination: destination,
      initialPrompt: "keep this",
      onSubmit: () => Promise.resolve({ kind: "rejected", reason: "destination-unavailable", message: "The selected workspace is no longer available." }),
    });

    button(composer, "[data-action='send']").click();
    await settleCatalog(composer);

    expect(promptText(composer)).toBe("keep this");
    expect(root(composer).querySelector("[role='alert']")?.textContent).toContain("no longer available");
    expect(button(composer, "[data-action='change-destination']").disabled).toBe(false);
    expect(dialogSurface(composer).busy).toBe(false);
  });

  it("turns a synchronous root submission failure into a recoverable editing error", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({
      initialDestination: destination,
      initialPrompt: "still here",
      onSubmit: () => { throw new Error("Navigation failed"); },
    });

    button(composer, "[data-action='send']").click();
    await settleCatalog(composer);

    expect(promptText(composer)).toBe("still here");
    expect(root(composer).querySelector("[role='alert']")?.textContent).toContain("Navigation failed");
    expect(dialogSurface(composer).busy).toBe(false);
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
    button(composer, "[data-action='send']").click();
    await settleCatalog(composer);
    expect(onSubmit).toHaveBeenCalledWith({ destination, firstPrompt: { text: "/review now", promptResourceCommandIdentity: identity } });
  });

  it("blocks unknown slash commands after validation without creating a session through footer or Enter", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    vi.spyOn(workspacesApi, "promptResourceCatalog").mockResolvedValue({ available: true, diagnostics: [], commands: [] });
    const onSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const composer = await mountComposer({ initialDestination: destination, initialPrompt: "/tree", onSubmit });

    button(composer, "[data-action='send']").click();
    await settleCatalog(composer);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(root(composer).querySelector("[role='alert']")?.textContent).toContain("/tree is not available");
    expect(button(composer, "[data-action='send']").disabled).toBe(true);

    pressPrompt(composer, "Enter");
    await settleCatalog(composer);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("ignores stale slash validation after editing, destination change, or cancel", async () => {
    const firstDestination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const replacementDestination = completeNewSessionDestination(machine("remote"), project("other"), workspace("feature", "other"));
    const validations: ReturnType<typeof deferredPromptResourceCatalog>[] = [];
    const promptResourceCatalog = vi.fn(() => {
      const validation = deferredPromptResourceCatalog();
      validations.push(validation);
      return validation.promise;
    });
    const onSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const onCancel = vi.fn<() => void>();
    const catalog = new InMemoryNewSessionDestinationCatalog({
      machines: [replacementDestination.machine],
      projectsByMachine: { remote: [replacementDestination.project] },
      workspacesByMachineAndProject: { "remote:other": [replacementDestination.workspace] },
    });
    const composer = await mountComposer({ initialDestination: firstDestination, initialPrompt: "/review", catalog, onSubmit, onCancel, promptResourceCatalog });

    await vi.waitFor(() => { expect(validations).toHaveLength(1); });
    validations[0]?.resolve({
      available: true,
      diagnostics: [],
      commands: [{ name: "review", source: "prompt", identity: { source: "prompt", name: "review", fingerprint: "b".repeat(64) } }],
    });
    await settleCatalog(composer);
    const editedValidationIndex = validations.length;
    button(composer, "[data-action='send']").click();
    await vi.waitFor(() => { expect(validations.length).toBeGreaterThan(editedValidationIndex); });
    await enterPrompt(composer, "plain replacement");
    validations[editedValidationIndex]?.resolve({ available: false, reason: "error", message: "Old destination unavailable" });
    await settleCatalog(composer);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(root(composer).querySelector("[role='alert']")).toBeNull();
    expect(promptText(composer)).toBe("plain replacement");

    await enterPrompt(composer, "/review");
    const destinationValidationIndex = validations.length;
    button(composer, "[data-action='send']").click();
    await vi.waitFor(() => { expect(validations.length).toBeGreaterThan(destinationValidationIndex); });
    button(composer, "[data-action='change-destination']").click();
    await settleCatalog(composer);
    button(composer, "[data-machine-id='remote']").click();
    await settleCatalog(composer);
    button(composer, "[data-project-id='other']").click();
    await settleCatalog(composer);
    button(composer, "[data-workspace-id='feature']").click();
    await composer.updateComplete;
    validations[destinationValidationIndex]?.resolve({ available: false, reason: "error", message: "Stale validation error" });
    await settleCatalog(composer);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(root(composer).querySelector("[role='alert']")).toBeNull();

    const cancelValidationIndex = validations.length;
    button(composer, "[data-action='send']").click();
    await vi.waitFor(() => { expect(validations.length).toBeGreaterThan(cancelValidationIndex); });
    button(composer, "[data-action='cancel']").click();
    validations[cancelValidationIndex]?.resolve({
      available: true,
      diagnostics: [],
      commands: [{ name: "review", source: "prompt", identity: { source: "prompt", name: "review", fingerprint: "c".repeat(64) } }],
    });
    await settleCatalog(composer);

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
        if (loads === 2) return Promise.reject(new Error("Catalog offline"));
        return Promise.resolve({ available: true, diagnostics: [], commands: [{ name: "review", source: "prompt", identity }] });
      },
    });

    button(composer, "[data-action='send']").click();
    await settleCatalog(composer);
    button(composer, "[data-action='retry-prompt-resource-validation']").click();
    await vi.waitFor(() => { expect(onSubmit).toHaveBeenCalledWith({ destination, firstPrompt: { text: "/review", promptResourceCommandIdentity: identity } }); });

    document.body.replaceChildren();
    const missingName = await mountComposer({ initialDestination: destination, initialPrompt: "/", onSubmit });
    button(missingName, "[data-action='send']").click();
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
    button(ambiguous, "[data-action='send']").click();
    await settleCatalog(ambiguous);
    expect(root(ambiguous).querySelector("[role='alert']")?.textContent).toContain("ambiguous");
  });

  it("lets plain text and attachment-only launches proceed when the prompt-resource catalog fails", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    vi.spyOn(workspacesApi, "promptResourceCatalog").mockRejectedValue(new Error("Catalog offline"));

    const textSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const textComposer = await mountComposer({ initialDestination: destination, initialPrompt: "plain text", onSubmit: textSubmit });
    button(textComposer, "[data-action='send']").click();
    await settleCatalog(textComposer);
    expect(textSubmit).toHaveBeenCalledWith({ destination, firstPrompt: { text: "plain text" } });

    document.body.replaceChildren();
    const attachmentSubmit = vi.fn((intent: NewSessionLaunchIntent): Promise<NewSessionSubmissionOutcome> => {
      expect(intent.destination).toEqual(destination);
      return Promise.resolve({ kind: "accepted" });
    });
    const attachmentComposer = await mountComposer({ initialDestination: destination, onSubmit: attachmentSubmit });
    await attachFile(attachmentComposer, new File(["hello"], "note.txt", { type: "text/plain" }));
    button(attachmentComposer, "[data-action='send']").click();
    await settleCatalog(attachmentComposer);
    expect(attachmentSubmit.mock.calls[0]?.[0].firstPrompt).toMatchObject({ text: "", attachments: [{ name: "note.txt", mimeType: "text/plain" }], delivery: "folder" });

    document.body.replaceChildren();
    const slashSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const slashComposer = await mountComposer({ initialDestination: destination, initialPrompt: "/review", onSubmit: slashSubmit });
    button(slashComposer, "[data-action='send']").click();
    await settleCatalog(slashComposer);
    expect(slashSubmit).not.toHaveBeenCalled();
    expect(root(slashComposer).querySelector("[data-action='retry-prompt-resource-validation']")?.textContent).toBe("Retry");
  });
});

describe("new-session-composer destination choice", () => {
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

    expect(deepActiveElement()).toBe(button(composer, "[data-action='change-destination']"));
    expect(button(composer, "[data-action='send']").disabled).toBe(true);

    button(composer, "[data-action='change-destination']").click();
    await settleCatalog(composer);
    button(composer, "[data-machine-id='remote']").click();
    await settleCatalog(composer);
    button(composer, "[data-project-id='forge']").click();
    await settleCatalog(composer);
    button(composer, "[data-workspace-id='feature']").click();
    await composer.updateComplete;

    expect(promptText(composer)).toBe("draft survives");
    expect(root(composer).querySelector("[data-destination-summary]")?.textContent).toContain("Project forge");
    expect(root(composer).querySelector("[data-destination-summary]")?.textContent).toContain("feature");
    expect(button(composer, "[data-action='send']").disabled).toBe(false);

    button(composer, "[data-action='send']").click();
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

    button(composer, "[data-action='change-destination']").click();
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

    button(composer, "[data-action='change-destination']").click();
    await settleCatalog(composer);

    expect(root(composer).querySelector("[data-state='machine-unavailable'][role='status']")?.textContent).toContain("No machines are currently available");
    expect(button(composer, "[data-machine-id='offline']").disabled).toBe(true);
    expect(button(composer, "[data-machine-id='failed']").disabled).toBe(true);
    expect(promptText(composer)).toBe("keep this prompt");
    expect(button(composer, "[data-action='send']").disabled).toBe(true);

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
    expect(button(composer, "[data-action='send']").disabled).toBe(false);
    button(composer, "[data-action='send']").click();
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

    button(composer, "[data-action='change-destination']").click();
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
    expect(button(composer, "[data-action='send']").disabled).toBe(true);
  });

  it("runs Back from a project catalog and preserves the prompt", async () => {
    const catalog = new InMemoryNewSessionDestinationCatalog({
      machines: [machine("remote")],
      projectsByMachine: { remote: [] },
    });
    const composer = await mountComposer({ initialPrompt: "project draft", catalog });

    button(composer, "[data-action='change-destination']").click();
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

    button(composer, "[data-action='change-destination']").click();
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

    button(composer, "[data-action='change-destination']").click();
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

    button(composer, "[data-action='change-destination']").click();
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
  it("keeps the accessible modal name without a visible duplicate titlebar or close action", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination });

    expect(dialogSection(composer).getAttribute("aria-label")).toBe("New session");
    expect(root(composer).querySelector(".dialog-header, h1, [data-action='close']")).toBeNull();
  });

  it("shows one concise destination identity without status or path detail", async () => {
    const destination = completeNewSessionDestination(machine("remote"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination });
    const summary = root(composer).querySelector("[data-destination-summary] .destination-copy");
    if (summary === null) throw new Error("Expected a destination summary");

    expect(summary.textContent.replaceAll(/\s+/g, " ").trim()).toBe("Project forge · main · Machine remote");
    expect(summary.textContent).not.toContain("Online");
    expect(summary.textContent).not.toContain("/repos/forge/main");
  });

  it("uses semantic button lists, keeps the summary to one line, and lets chooser detail wrap", async () => {
    const catalog = new InMemoryNewSessionDestinationCatalog({
      machines: [machine("remote")],
      projectsByMachine: { remote: [project("forge")] },
      workspacesByMachineAndProject: { "remote:forge": [workspace("feature", "forge")] },
    });
    const composer = await mountComposer({ catalog });

    button(composer, "[data-action='change-destination']").click();
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
    expect(styles).toContain(".destination-identity { min-width: 0; display: flex; align-items: baseline; white-space: nowrap;");
    expect(styles).toContain(".destination-part { min-width: 0; overflow: hidden; text-overflow: ellipsis;");
    expect(styles).toContain(".catalog-item-copy strong, .catalog-item-copy small { min-width: 0; overflow-wrap: anywhere; white-space: normal;");
  });

  it("hosts the shared draft rather than retaining textarea-specific prompt styling", () => {
    const styles = newSessionComposerStyles.cssText.replaceAll(/\s+/g, " ");

    expect(styles).toContain("composer-draft { display: block; min-width: 0;");
    expect(styles).not.toContain("textarea { box-sizing: border-box; width: 100%; min-height");
  });
});

describe("new-session-composer modal lifetime", () => {
  it("Cancel, Escape, and backdrop close without submitting when not busy", async () => {
    const onCancel = vi.fn<() => void>();
    const onSubmit = vi.fn((): Promise<NewSessionSubmissionOutcome> => Promise.resolve({ kind: "accepted" }));
    const composer = await mountComposer({ onCancel, onSubmit });

    button(composer, "[data-action='cancel']").click();
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
    button(composer, "[data-action='cancel']").click();

    expect(returned).toHaveBeenCalledExactlyOnceWith("recovery-1", { text: "edited", attachments: [attachment], delivery: "inline" });
  });

  it("keeps prompt-resource identity out of the draft but returns it with claimed recovery rollback", async () => {
    const identity: PromptResourceCommandIdentity = { source: "prompt", name: "review", fingerprint: "a".repeat(64) };
    const returned = vi.fn<NonNullable<NewSessionComposer["onReturnRecoveryDraft"]>>();
    const composer = new NewSessionComposer();
    composer.recoverySeedId = "recovery-1";
    composer.onClaimRecoveryDraft = (id: string) => ({ id, snapshot: { text: "/review src", delivery: "inline", promptResourceCommandIdentity: identity } });
    composer.onReturnRecoveryDraft = returned;
    document.body.append(composer);
    await settleRenderedDialog(composer);
    await composer.updateComplete;

    button(composer, "[data-action='cancel']").click();

    expect(returned).toHaveBeenCalledExactlyOnceWith("recovery-1", { text: "/review src", promptResourceCommandIdentity: identity });
  });

  it("focusExisting returns focus to the same draft without reinitializing it", async () => {
    const composer = await mountComposer({ initialPrompt: "original" });
    await enterPrompt(composer, "edited locally");
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    composer.focusExisting();

    expect(deepActiveElement()).toBe(button(composer, "[data-action='change-destination']"));
    expect(promptText(composer)).toBe("edited locally");
  });

  it("preserves the local prompt and destination across ordinary responsive rerenders", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination, initialPrompt: "before" });
    await enterPrompt(composer, "after resize");

        composer.requestUpdate();
    await composer.updateComplete;

    expect(promptText(composer)).toBe("after resize");
    expect(root(composer).querySelector("[data-destination-summary]")?.textContent).toContain("Project forge");
  });
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});
