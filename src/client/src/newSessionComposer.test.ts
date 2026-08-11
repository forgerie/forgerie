import { describe, expect, it } from "vitest";
import type { Machine, Project, Workspace } from "./api";
import {
  InMemoryNewSessionDestinationCatalog,
  backToProjectChoice,
  beginNewSessionSubmission,
  canSubmitNewSession,
  chooseNewSessionMachine,
  chooseNewSessionProject,
  chooseNewSessionWorkspace,
  completeNewSessionDestination,
  createNewSessionComposerState,
  isNewSessionMachineAvailable,
  refreshNewSessionCatalog,
  resolveNewSessionMachines,
  resolveNewSessionProjects,
  resolveNewSessionWorkspaces,
  startNewSessionDestinationChoice,
} from "./newSessionComposer";

const machine = (id: string, status: Machine["status"] = "online"): Machine => ({
  id,
  name: id === "local" ? "This machine" : `Machine ${id}`,
  kind: id === "local" ? "local" : "remote",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  status,
});

const project = (id: string): Project => ({ id, name: `Project ${id}`, path: `/repos/${id}`, createdAt: "2026-08-10T00:00:00.000Z" });

const workspace = (id: string, projectId: string): Workspace => ({
  id,
  projectId,
  path: `/repos/${projectId}/${id}`,
  label: id,
  isMain: id === "main",
  isGitRepo: true,
  isGitWorktree: id !== "main",
  effectiveConfig: {},
});

describe("new-session composer state", () => {
  it.each([
    { status: "online" as const, available: true },
    { status: "unknown" as const, available: true },
    { status: "offline" as const, available: false },
    { status: "error" as const, available: false },
  ])("reports $status machines as available=$available", ({ status: machineStatus, available }) => {
    expect(isNewSessionMachineAvailable(machine("remote", machineStatus))).toBe(available);
  });

  it("requires a structurally complete, available destination and a non-empty first-prompt snapshot", () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const state = createNewSessionComposerState(destination);

    expect(state.kind).toBe("editing");
    expect(canSubmitNewSession(state, { text: "" })).toBe(false);
    expect(canSubmitNewSession(state, { text: "  build the feature  " })).toBe(true);
    expect(beginNewSessionSubmission(state, { text: "  build the feature  " })).toMatchObject({
      kind: "submitting",
      submission: { text: "  build the feature  " },
    });

    const offline = createNewSessionComposerState(completeNewSessionDestination(machine("remote", "offline"), project("forge"), workspace("main", "forge")));
    expect(canSubmitNewSession(offline, { text: "hello" })).toBe(false);
  });

  it("accepts attachment-only input and keeps a copied structured launch submission", () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const attachment = { kind: "file" as const, mimeType: "text/plain", data: "Zm9v", name: "note.txt" };
    const state = beginNewSessionSubmission(createNewSessionComposerState(destination), { text: "", attachments: [attachment], delivery: "folder" });

    expect(state).toMatchObject({
      kind: "submitting",
      destination,
      submission: { text: "", attachments: [attachment], delivery: "folder" },
    });
    if (state.kind !== "submitting") throw new Error("Expected submitting state");
    expect(state.submission.attachments).not.toBe([attachment]);
  });

  it("carries validated prompt-resource identity only with the structured submission", () => {
    const destination = completeNewSessionDestination(machine("local"), project("forge"), workspace("main", "forge"));
    const identity = { source: "prompt" as const, name: "review", fingerprint: "a".repeat(64) };

    expect(canSubmitNewSession(createNewSessionComposerState(destination), { text: "/review src" })).toBe(false);
    expect(beginNewSessionSubmission(createNewSessionComposerState(destination), { text: "/review src" })).toMatchObject({ kind: "editing" });
    expect(beginNewSessionSubmission(createNewSessionComposerState(destination), { text: "/review src", promptResourceCommandIdentity: identity })).toMatchObject({
      kind: "submitting",
      submission: { text: "/review src", promptResourceCommandIdentity: identity },
    });
  });

  it("chooses another machine, project, and workspace without owning prompt text", () => {
    const original = completeNewSessionDestination(machine("local"), project("one"), workspace("main", "one"));
    let state = createNewSessionComposerState(original);

    state = startNewSessionDestinationChoice(state, 1);
    state = resolveNewSessionMachines(state, 1, { kind: "ready", items: [machine("remote")] });
    state = chooseNewSessionMachine(state, machine("remote"), 2);
    state = resolveNewSessionProjects(state, 2, { kind: "ready", items: [project("two")] });
    state = chooseNewSessionProject(state, project("two"), 3);
    state = resolveNewSessionWorkspaces(state, 3, { kind: "ready", items: [workspace("feature", "two")] });
    state = chooseNewSessionWorkspace(state, workspace("feature", "two"));

    expect(state).toMatchObject({
      kind: "editing",
      destination: {
        kind: "complete",
        machine: { id: "remote" },
        project: { id: "two" },
        workspace: { id: "feature" },
      },
    });
  });

  it("models loading, empty, and error catalog outcomes without inventing a selection", () => {
    let state = startNewSessionDestinationChoice(createNewSessionComposerState(), 4);
    expect(state).toMatchObject({ kind: "choosing", choice: { step: "machine", catalog: { kind: "loading" } } });

    state = resolveNewSessionMachines(state, 4, { kind: "ready", items: [] });
    expect(state).toMatchObject({ choice: { catalog: { kind: "empty" } }, destination: { kind: "required" } });

    state = refreshNewSessionCatalog(state, 5);
    state = resolveNewSessionMachines(state, 5, { kind: "error", message: "Machines unavailable" });
    expect(state).toMatchObject({ choice: { catalog: { kind: "error", message: "Machines unavailable" } } });
  });

  it("accepts destination choices only from the active ready catalog", () => {
    const remote = machine("remote");
    let state = startNewSessionDestinationChoice(createNewSessionComposerState(), 1);

    expect(chooseNewSessionMachine(state, remote, 2)).toBe(state);
    state = resolveNewSessionMachines(state, 1, { kind: "ready", items: [remote] });
    expect(chooseNewSessionMachine(state, machine("other"), 2)).toBe(state);

    state = chooseNewSessionMachine(state, remote, 2);
    expect(chooseNewSessionProject(state, project("other"), 3)).toBe(state);
    state = resolveNewSessionProjects(state, 2, { kind: "ready", items: [project("forge")] });
    state = chooseNewSessionProject(state, project("forge"), 3);
    expect(chooseNewSessionWorkspace(state, workspace("other", "forge"))).toBe(state);
  });

  it("ignores stale project and workspace results after the active choice changes", () => {
    let state = startNewSessionDestinationChoice(createNewSessionComposerState(), 1);
    state = resolveNewSessionMachines(state, 1, { kind: "ready", items: [machine("a"), machine("b")] });
    state = chooseNewSessionMachine(state, machine("a"), 2);
    state = refreshNewSessionCatalog(state, 3);

    const staleProjectState = resolveNewSessionProjects(state, 2, { kind: "ready", items: [project("stale")] });
    expect(staleProjectState).toBe(state);

    state = resolveNewSessionProjects(state, 3, { kind: "ready", items: [project("current")] });
    state = chooseNewSessionProject(state, project("current"), 4);
    state = backToProjectChoice(state, 5);
    const staleWorkspaceState = resolveNewSessionWorkspaces(state, 4, { kind: "ready", items: [workspace("stale", "current")] });
    expect(staleWorkspaceState).toBe(state);
  });
});

describe("in-memory new-session destination catalog", () => {
  it("loads cross-machine projects and workspaces and exposes configured failures", async () => {
    const catalog = new InMemoryNewSessionDestinationCatalog({
      machines: [machine("local"), machine("remote")],
      projectsByMachine: { remote: [project("forge")] },
      workspacesByMachineAndProject: { "remote:forge": [workspace("feature", "forge")] },
      errors: { projectsByMachine: { local: "Project catalog failed" } },
    });

    await expect(catalog.loadMachines()).resolves.toHaveLength(2);
    await expect(catalog.loadProjects("remote")).resolves.toMatchObject([{ id: "forge" }]);
    await expect(catalog.loadWorkspaces("remote", "forge")).resolves.toMatchObject([{ id: "feature" }]);
    await expect(catalog.loadProjects("local")).rejects.toThrow("Project catalog failed");
  });
});
