import type { Machine, Project, Workspace } from "./api";
import { machinesApi, projectsApi, workspacesApi } from "./api";
import type { NewSessionAgentChoices, PromptAttachment, PromptAttachmentDelivery } from "../../shared/apiTypes";
import { parseLeadingSlashCommand, type PromptResourceCommandIdentity } from "../../shared/promptResourceCommand";

export interface NewSessionCompleteDestination {
  kind: "complete";
  machine: Machine;
  project: Project;
  workspace: Workspace;
}

export interface NewSessionRequiredDestination {
  kind: "required";
}

export type NewSessionDestination = NewSessionCompleteDestination | NewSessionRequiredDestination;

export interface NewSessionFirstPromptSubmission {
  readonly text: string;
  readonly attachments?: readonly PromptAttachment[] | undefined;
  readonly delivery?: PromptAttachmentDelivery | undefined;
  readonly promptResourceCommandIdentity?: PromptResourceCommandIdentity | undefined;
}

export type NewSessionComposerSnapshot = NewSessionFirstPromptSubmission;

export interface NewSessionLaunchIntent {
  destination: NewSessionCompleteDestination;
  firstPrompt: NewSessionFirstPromptSubmission;
  /** Model, thinking level, and guidance chosen before the session existed. */
  agentChoices?: NewSessionAgentChoices;
}

export type NewSessionSubmissionOutcome =
  | { kind: "accepted" }
  | { kind: "rejected"; reason: "destination-unavailable" | "launch-rejected"; message: string };

export interface NewSessionDestinationCatalog {
  loadMachines(): Promise<readonly Machine[]>;
  loadProjects(machineId: string): Promise<readonly Project[]>;
  loadWorkspaces(machineId: string, projectId: string): Promise<readonly Workspace[]>;
}

export type NewSessionCatalogResolution<T> =
  | { kind: "ready"; items: readonly T[] }
  | { kind: "error"; message: string };

export type NewSessionCatalogState<T> =
  | { kind: "loading"; requestId: number }
  | { kind: "empty"; requestId: number }
  | { kind: "ready"; requestId: number; items: readonly T[] }
  | { kind: "error"; requestId: number; message: string };

export type NewSessionDestinationChoice =
  | { step: "machine"; catalog: NewSessionCatalogState<Machine> }
  | { step: "project"; machine: Machine; catalog: NewSessionCatalogState<Project> }
  | { step: "workspace"; machine: Machine; project: Project; catalog: NewSessionCatalogState<Workspace> };

export type NewSessionComposerState =
  | { kind: "editing"; destination: NewSessionDestination; submissionError?: NewSessionSubmissionOutcome & { kind: "rejected" } }
  | { kind: "choosing"; destination: NewSessionDestination; choice: NewSessionDestinationChoice }
  | { kind: "submitting"; destination: NewSessionCompleteDestination };

export function completeNewSessionDestination(machine: Machine, project: Project, workspace: Workspace): NewSessionCompleteDestination {
  return { kind: "complete", machine, project, workspace };
}

export function createNewSessionComposerState(destination?: NewSessionCompleteDestination): NewSessionComposerState {
  return { kind: "editing", destination: destination ?? { kind: "required" } };
}

export function canSubmitNewSession(
  state: NewSessionComposerState,
  snapshot: NewSessionComposerSnapshot,
): state is Extract<NewSessionComposerState, { kind: "editing" }> & { destination: NewSessionCompleteDestination } {
  return state.kind === "editing"
    && isValidNewSessionDestination(state.destination)
    && !newSessionSubmissionIsEmpty(snapshot)
    && !requiresPromptResourceIdentity(snapshot);
}

export function isValidNewSessionDestination(destination: NewSessionDestination): destination is NewSessionCompleteDestination {
  if (destination.kind !== "complete") return false;
  return destination.machine.id.trim().length > 0
    && destination.project.id.trim().length > 0
    && destination.workspace.id.trim().length > 0
    && destination.workspace.path.trim().length > 0
    && destination.workspace.projectId === destination.project.id
    && isNewSessionMachineAvailable(destination.machine);
}

export function isNewSessionMachineAvailable(machine: Machine): boolean {
  return machine.status !== "offline" && machine.status !== "error";
}

export function beginNewSessionSubmission(
  state: NewSessionComposerState,
  snapshot: NewSessionComposerSnapshot,
): NewSessionComposerState {
  if (!canSubmitNewSession(state, snapshot)) return state;
  return { kind: "submitting", destination: state.destination };
}

export function rejectNewSessionSubmission(
  state: NewSessionComposerState,
  rejection: Extract<NewSessionSubmissionOutcome, { kind: "rejected" }>,
): NewSessionComposerState {
  if (state.kind !== "submitting") return state;
  return { kind: "editing", destination: state.destination, submissionError: rejection };
}

export function startNewSessionDestinationChoice(state: NewSessionComposerState, requestId: number): NewSessionComposerState {
  if (state.kind === "submitting") return state;
  return {
    kind: "choosing",
    destination: state.destination,
    choice: { step: "machine", catalog: { kind: "loading", requestId } },
  };
}

export function chooseNewSessionMachine(state: NewSessionComposerState, machine: Machine, requestId: number): NewSessionComposerState {
  if (state.kind !== "choosing" || state.choice.step !== "machine" || state.choice.catalog.kind !== "ready") return state;
  const availableMachine = state.choice.catalog.items.find((item) => item.id === machine.id);
  if (availableMachine === undefined || !isNewSessionMachineAvailable(availableMachine)) return state;
  return {
    kind: "choosing",
    destination: state.destination,
    choice: { step: "project", machine: availableMachine, catalog: { kind: "loading", requestId } },
  };
}

export function chooseNewSessionProject(state: NewSessionComposerState, project: Project, requestId: number): NewSessionComposerState {
  if (state.kind !== "choosing" || state.choice.step !== "project" || state.choice.catalog.kind !== "ready") return state;
  const availableProject = state.choice.catalog.items.find((item) => item.id === project.id);
  if (availableProject === undefined) return state;
  return {
    kind: "choosing",
    destination: state.destination,
    choice: { step: "workspace", machine: state.choice.machine, project: availableProject, catalog: { kind: "loading", requestId } },
  };
}

export function chooseNewSessionWorkspace(state: NewSessionComposerState, workspace: Workspace): NewSessionComposerState {
  if (state.kind !== "choosing" || state.choice.step !== "workspace" || state.choice.catalog.kind !== "ready") return state;
  const { machine, project, catalog } = state.choice;
  const availableWorkspace = catalog.items.find((item) => item.id === workspace.id && item.projectId === project.id);
  if (availableWorkspace === undefined) return state;
  return {
    kind: "editing",
    destination: completeNewSessionDestination(machine, project, availableWorkspace),
  };
}

export function backToMachineChoice(state: NewSessionComposerState, requestId: number): NewSessionComposerState {
  if (state.kind !== "choosing" || state.choice.step !== "project") return state;
  return {
    kind: "choosing",
    destination: state.destination,
    choice: { step: "machine", catalog: { kind: "loading", requestId } },
  };
}

export function backToProjectChoice(state: NewSessionComposerState, requestId: number): NewSessionComposerState {
  if (state.kind !== "choosing" || state.choice.step !== "workspace") return state;
  return {
    kind: "choosing",
    destination: state.destination,
    choice: { step: "project", machine: state.choice.machine, catalog: { kind: "loading", requestId } },
  };
}

export function refreshNewSessionCatalog(state: NewSessionComposerState, requestId: number): NewSessionComposerState {
  if (state.kind !== "choosing") return state;
  const choice = state.choice;
  if (choice.step === "machine") {
    return { ...state, choice: { step: "machine", catalog: { kind: "loading", requestId } } };
  }
  if (choice.step === "project") {
    return { ...state, choice: { step: "project", machine: choice.machine, catalog: { kind: "loading", requestId } } };
  }
  return { ...state, choice: { step: "workspace", machine: choice.machine, project: choice.project, catalog: { kind: "loading", requestId } } };
}

export function resolveNewSessionMachines(
  state: NewSessionComposerState,
  requestId: number,
  resolution: NewSessionCatalogResolution<Machine>,
): NewSessionComposerState {
  if (!isActiveCatalogRequest(state, "machine", requestId)) return state;
  return { ...state, choice: { step: "machine", catalog: resolvedCatalog(requestId, resolution) } };
}

export function resolveNewSessionProjects(
  state: NewSessionComposerState,
  requestId: number,
  resolution: NewSessionCatalogResolution<Project>,
): NewSessionComposerState {
  if (!isActiveCatalogRequest(state, "project", requestId)) return state;
  return { ...state, choice: { step: "project", machine: state.choice.machine, catalog: resolvedCatalog(requestId, resolution) } };
}

export function resolveNewSessionWorkspaces(
  state: NewSessionComposerState,
  requestId: number,
  resolution: NewSessionCatalogResolution<Workspace>,
): NewSessionComposerState {
  if (!isActiveCatalogRequest(state, "workspace", requestId)) return state;
  return { ...state, choice: { step: "workspace", machine: state.choice.machine, project: state.choice.project, catalog: resolvedCatalog(requestId, resolution) } };
}

function isActiveCatalogRequest<S extends NewSessionDestinationChoice["step"]>(
  state: NewSessionComposerState,
  step: S,
  requestId: number,
): state is Extract<NewSessionComposerState, { kind: "choosing" }> & { choice: Extract<NewSessionDestinationChoice, { step: S }> } {
  return state.kind === "choosing" && state.choice.step === step && state.choice.catalog.kind === "loading" && state.choice.catalog.requestId === requestId;
}

function resolvedCatalog<T>(requestId: number, resolution: NewSessionCatalogResolution<T>): NewSessionCatalogState<T> {
  if (resolution.kind === "error") return { kind: "error", requestId, message: resolution.message };
  return resolution.items.length === 0
    ? { kind: "empty", requestId }
    : { kind: "ready", requestId, items: resolution.items };
}

function newSessionSubmissionIsEmpty(submission: NewSessionComposerSnapshot): boolean {
  return submission.text.trim() === "" && (submission.attachments === undefined || submission.attachments.length === 0);
}

function requiresPromptResourceIdentity(submission: NewSessionComposerSnapshot): boolean {
  const parsed = parseLeadingSlashCommand(submission.text);
  return parsed.kind !== "not-command" && submission.promptResourceCommandIdentity === undefined;
}

export function createApiNewSessionDestinationCatalog(): NewSessionDestinationCatalog {
  return {
    loadMachines: () => machinesApi.machines(),
    loadProjects: (machineId) => projectsApi.projects(machineId),
    loadWorkspaces: (machineId, projectId) => workspacesApi.workspaces(projectId, machineId),
  };
}

export interface InMemoryNewSessionDestinationCatalogConfig {
  machines?: readonly Machine[];
  projectsByMachine?: Readonly<Record<string, readonly Project[]>>;
  workspacesByMachineAndProject?: Readonly<Record<string, readonly Workspace[]>>;
  errors?: {
    machines?: string;
    projectsByMachine?: Readonly<Record<string, string>>;
    workspacesByMachineAndProject?: Readonly<Record<string, string>>;
  };
}

/** Deterministic destination catalog for component tests and isolated previews. */
export class InMemoryNewSessionDestinationCatalog implements NewSessionDestinationCatalog {
  constructor(private readonly config: InMemoryNewSessionDestinationCatalogConfig = {}) {}

  loadMachines(): Promise<readonly Machine[]> {
    return configuredResult(this.config.machines ?? [], this.config.errors?.machines);
  }

  loadProjects(machineId: string): Promise<readonly Project[]> {
    return configuredResult(this.config.projectsByMachine?.[machineId] ?? [], this.config.errors?.projectsByMachine?.[machineId]);
  }

  loadWorkspaces(machineId: string, projectId: string): Promise<readonly Workspace[]> {
    const key = `${machineId}:${projectId}`;
    return configuredResult(this.config.workspacesByMachineAndProject?.[key] ?? [], this.config.errors?.workspacesByMachineAndProject?.[key]);
  }
}

function configuredResult<T>(items: readonly T[], error: string | undefined): Promise<readonly T[]> {
  return error === undefined ? Promise.resolve([...items]) : Promise.reject(new Error(error));
}
