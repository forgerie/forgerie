// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine, Project, Workspace } from "../api";
import type { NewSessionDestinationCatalog, NewSessionLaunchIntent, NewSessionSubmissionOutcome } from "../newSessionComposer";
import { InMemoryNewSessionDestinationCatalog, completeNewSessionDestination } from "../newSessionComposer";
import { NewSessionComposer } from "./NewSessionComposer";
import { deepActiveElement, dialogSection, dialogSurface, settleRenderedDialog, surfaceBackdrop } from "./modalSurfaceTestSupport";
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
} = {}): Promise<NewSessionComposer> {
  const composer = new NewSessionComposer();
  if (options.initialDestination !== undefined) composer.initialDestination = options.initialDestination;
  if (options.initialPrompt !== undefined) composer.initialPrompt = options.initialPrompt;
  if (options.catalog !== undefined) composer.catalog = options.catalog;
  if (options.onCancel !== undefined) composer.onCancel = options.onCancel;
  if (options.onSubmit !== undefined) composer.onSubmit = options.onSubmit;
  document.body.append(composer);
  await settleRenderedDialog(composer);
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

function promptField(composer: NewSessionComposer): HTMLTextAreaElement {
  const element = root(composer).querySelector("textarea[data-field='prompt']");
  if (!(element instanceof HTMLTextAreaElement)) throw new Error("Expected first-prompt textarea");
  return element;
}

async function enterPrompt(composer: NewSessionComposer, value: string): Promise<void> {
  const field = promptField(composer);
  field.value = value;
  field.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  await composer.updateComplete;
}

async function settleCatalog(composer: NewSessionComposer): Promise<void> {
  await Promise.resolve();
  await composer.updateComplete;
  await Promise.resolve();
  await composer.updateComplete;
}

describe("new-session-composer editing and submission", () => {
  it("focuses a complete default's prompt and enables Send only for non-empty text", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination });
    const send = button(composer, "[data-action='send']");

    expect(dialogSection(composer).getAttribute("aria-label")).toBe("New session");
    expect(deepActiveElement()).toBe(promptField(composer));
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
    await composer.updateComplete;

    expect(onSubmit).toHaveBeenCalledWith({ destination, firstPrompt: { text: "  exact prompt  " } });
    expect(dialogSurface(composer).busy).toBe(true);
    expect(button(composer, "[data-action='cancel']").disabled).toBe(true);
    surfaceBackdrop(composer).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    expect(onCancel).not.toHaveBeenCalled();

    resolveSubmission?.({ kind: "accepted" });
    await settleCatalog(composer);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(dialogSurface(composer).busy).toBe(true);
    expect(promptField(composer).disabled).toBe(true);
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

    expect(promptField(composer).value).toBe("keep this");
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

    expect(promptField(composer).value).toBe("still here");
    expect(root(composer).querySelector("[role='alert']")?.textContent).toContain("Navigation failed");
    expect(dialogSurface(composer).busy).toBe(false);
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

    expect(promptField(composer).value).toBe("draft survives");
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
    expect(promptField(composer).value).toBe("preserved");
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
    expect(promptField(composer).value).toBe("keep this prompt");
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

    expect(promptField(composer).value).toBe("keep this prompt");
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
    expect(promptField(composer).value).toBe("keep me");
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
    expect(promptField(composer).value).toBe("project draft");
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
    expect(promptField(composer).value).toBe("rapid draft");
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
    expect(promptField(composer).value).toBe("workspace draft");
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

  it("uses the existing control font tokens for the first prompt", () => {
    const styles = newSessionComposerStyles.cssText.replaceAll(/\s+/g, " ");

    expect(styles).toContain("font: var(--pi-control-font-size, 16px)/1.45 var(--pi-control-font-family, system-ui, sans-serif)");
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

  it("focusExisting returns focus to the same draft without reinitializing it", async () => {
    const composer = await mountComposer({ initialPrompt: "original" });
    await enterPrompt(composer, "edited locally");
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    composer.focusExisting();

    expect(deepActiveElement()).toBe(button(composer, "[data-action='change-destination']"));
    expect(promptField(composer).value).toBe("edited locally");
  });

  it("preserves the local prompt and destination across ordinary responsive rerenders", async () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const composer = await mountComposer({ initialDestination: destination, initialPrompt: "before" });
    await enterPrompt(composer, "after resize");

    composer.initialPrompt = "replacement must not win";
    composer.requestUpdate();
    await composer.updateComplete;

    expect(promptField(composer).value).toBe("after resize");
    expect(root(composer).querySelector("[data-destination-summary]")?.textContent).toContain("Project forge");
  });
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});
