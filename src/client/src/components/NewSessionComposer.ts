import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { PromptResourceCatalogResponse } from "../../../shared/promptResourceCommand";
import { parseLeadingSlashCommand } from "../../../shared/promptResourceCommand";
import { workspacesApi, type Machine, type Project, type Workspace } from "../api";
import { createPreSessionComposerRuntime, type ComposerRuntime } from "../composerRuntime";
import {
  backToMachineChoice,
  backToProjectChoice,
  beginNewSessionSubmission,
  chooseNewSessionMachine,
  chooseNewSessionProject,
  chooseNewSessionWorkspace,
  createApiNewSessionDestinationCatalog,
  createNewSessionComposerState,
  refreshNewSessionCatalog,
  rejectNewSessionSubmission,
  resolveNewSessionMachines,
  resolveNewSessionProjects,
  resolveNewSessionWorkspaces,
  startNewSessionDestinationChoice,
  type NewSessionCompleteDestination,
  type NewSessionComposerState,
  type NewSessionDestinationCatalog,
  type NewSessionFirstPromptSubmission,
  type NewSessionLaunchIntent,
  type NewSessionSubmissionOutcome,
} from "../newSessionComposer";
import type { ModalSurface } from "./ModalSurface";
import "./ComposerDraft";
import type { ComposerDraft, ComposerDraftDisplayState, ComposerDraftSeed, ComposerDraftSubmitSnapshot } from "./ComposerDraft";
import "./ModalSurface";
import { newSessionComposerStyles } from "./shared";

interface SlashValidationError {
  readonly message: string;
  readonly retryable: boolean;
}

type NewSessionRecoveryDraftSeed = ComposerDraftSeed & { snapshot: NewSessionFirstPromptSubmission };

@customElement("new-session-composer")
export class NewSessionComposer extends LitElement {
  /** Initial values are read once. Later property updates never replace the mounted local draft. */
  @property({ attribute: false }) initialDestination?: NewSessionCompleteDestination;
  @property({ attribute: false }) recoverySeedId?: string;
  @property({ attribute: false }) catalog: NewSessionDestinationCatalog = createApiNewSessionDestinationCatalog();
  @property({ attribute: false }) onCancel?: () => void;
  @property({ attribute: false }) onSubmit?: (intent: NewSessionLaunchIntent) => Promise<NewSessionSubmissionOutcome> | NewSessionSubmissionOutcome;
  @property({ attribute: false }) onClaimRecoveryDraft?: (recoverySeedId: string) => NewSessionRecoveryDraftSeed | undefined;
  @property({ attribute: false }) onReturnRecoveryDraft?: (recoverySeedId: string, snapshot: NewSessionFirstPromptSubmission) => void;
  @property({ attribute: false }) promptResourceCatalog: (projectId: string, workspaceId: string, machineId: string) => Promise<PromptResourceCatalogResponse> = (projectId, workspaceId, machineId) => workspacesApi.promptResourceCatalog(projectId, workspaceId, machineId);

  @state() private composerState: NewSessionComposerState = createNewSessionComposerState();
  @state() private draftDisplay: ComposerDraftDisplayState = { inputMode: { kind: "normal" }, empty: true, focused: false, attachmentCount: 0 };
  @state() private slashValidationError: SlashValidationError | undefined;
  @query("modal-surface") private modalSurface?: ModalSurface;
  @query("composer-draft") private draft?: ComposerDraft;

  private initialized = false;
  private requestGeneration = 0;
  private runtimeGeneration = 0;
  private focusRegion = "";
  private runtime: ComposerRuntime = createPreSessionComposerRuntime({ machineId: "local" });
  private claimedRecoverySeedId: string | undefined;
  private claimedRecoveryPromptResourceCommandIdentity: NewSessionFirstPromptSubmission["promptResourceCommandIdentity"];

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    if (!this.initialized) {
      this.initialized = true;
      this.composerState = createNewSessionComposerState(this.initialDestination);
      this.replaceRuntimeForDestination(this.composerState.destination);
    }
  }

  protected override updated(): void {
    this.claimRecoveryDraftOnce();
    const focusRegion = stateFocusRegion(this.composerState);
    if (focusRegion === this.focusRegion) return;
    this.focusRegion = focusRegion;
    this.focusCurrentRegion();
  }

  override disconnectedCallback(): void {
    this.requestGeneration += 1;
    this.runtimeGeneration += 1;
    super.disconnectedCallback();
  }

  /** Refocuses this mounted composer without replacing its destination or draft. */
  focusExisting(): void {
    this.focusCurrentRegion();
  }

  override render(): TemplateResult {
    const state = this.composerState;
    const submitting = state.kind === "submitting";
    return html`
      <modal-surface
        .label=${"New session"}
        .initialFocus=${initialFocusSelector(state)}
        .busy=${submitting}
        .onClose=${() => { this.requestCancel(); }}
      >
        <form class="composer" @submit=${(event: SubmitEvent) => { this.handleFooterSubmit(event); }}>
          <div class="dialog-scroll">
            <section class="field" aria-labelledby="new-session-destination-label">
              <h2 class="field-label" id="new-session-destination-label">Destination</h2>
              ${state.kind === "choosing" ? this.renderDestinationChoice(state) : this.renderDestinationSummary(state)}
            </section>

            <section class="field">
              <h2 class="field-label" id="new-session-prompt-label">First prompt</h2>
              <composer-draft
                aria-labelledby="new-session-prompt-label"
                data-field="prompt"
                .editorLabel=${"First prompt"}
                .placeholderText=${this.placeholderForState(state)}
                .runtime=${this.runtime}
                .disabled=${submitting}
                .submissionDisabled=${this.slashValidationError !== undefined}
                .onSubmit=${(snapshot: ComposerDraftSubmitSnapshot) => this.handleDraftSubmit(snapshot)}
                .onDisplayStateChange=${(display: ComposerDraftDisplayState) => { this.draftDisplay = display; }}
                .onDraftEdited=${() => { this.clearValidationError(); }}
                .onCompletionError=${() => { this.clearValidationError(); }}
              ></composer-draft>
              ${this.slashValidationError === undefined ? nothing : html`
                <div class="submission-error" role="alert">
                  <p>${this.slashValidationError.message}</p>
                  ${this.slashValidationError.retryable ? html`<button type="button" data-action="retry-prompt-resource-validation" @click=${() => { this.retryPromptResourceValidation(); }}>Retry</button>` : nothing}
                </div>
              `}
            </section>

            ${state.kind === "editing" && state.submissionError !== undefined
              ? html`<p class="submission-error" role="alert">${state.submissionError.message}</p>`
              : nothing}
          </div>

          <footer class="dialog-footer">
            ${submitting ? html`<span class="busy-label" role="status">Checking destination…</span>` : nothing}
            <button type="button" data-action="cancel" ?disabled=${submitting} @click=${() => { this.requestCancel(); }}>Cancel</button>
            <button class="primary" type="submit" data-action="send" ?disabled=${!this.footerSendAvailable(state)}>${submitting ? "Sending…" : "Send"}</button>
          </footer>
        </form>
      </modal-surface>
    `;
  }

  private renderDestinationSummary(state: Exclude<NewSessionComposerState, { kind: "choosing" }>): TemplateResult {
    const destination = state.destination;
    return html`
      <div class="destination-summary" data-destination-summary>
        ${destination.kind === "complete"
          ? html`
              <span class="destination-copy">
                <strong class="destination-identity">
                  <span class="destination-part destination-project">${destination.project.name}</span>
                  <span class="destination-separator">·</span>
                  <span class="destination-part destination-workspace">${destination.workspace.label}</span>
                  <span class="destination-separator">·</span>
                  <span class="destination-part destination-machine">${destination.machine.name}</span>
                </strong>
              </span>
            `
          : html`<span class="destination-copy destination-required"><strong>Destination required</strong><small>Choose a machine, project, and workspace.</small></span>`}
        <button
          type="button"
          data-action="change-destination"
          ?disabled=${state.kind === "submitting"}
          @click=${() => { this.openDestinationChoice(); }}
        >${destination.kind === "complete" ? "Change" : "Choose"}</button>
      </div>
    `;
  }

  private renderDestinationChoice(state: Extract<NewSessionComposerState, { kind: "choosing" }>): TemplateResult {
    const choice = state.choice;
    const heading = choice.step === "machine"
      ? "Choose a machine"
      : choice.step === "project"
        ? `Choose a project on ${choice.machine.name}`
        : `Choose a workspace in ${choice.project.name}`;
    return html`
      <div class="chooser" data-chooser-primary tabindex="-1">
        <h3 class="chooser-heading">${heading}</h3>
        ${choice.step === "machine"
          ? this.renderMachines(choice.catalog)
          : choice.step === "project"
            ? this.renderProjects(choice.machine, choice.catalog)
            : this.renderWorkspaces(choice.machine, choice.project, choice.catalog)}
      </div>
    `;
  }

  private renderMachines(catalog: Extract<Extract<NewSessionComposerState, { kind: "choosing" }>["choice"], { step: "machine" }>["catalog"]): TemplateResult {
    if (catalog.kind === "loading") {
      return html`
        <div class="catalog-state" data-state="machine-loading" role="status">
          <p>Loading machines…</p>
          <button type="button" data-action="refresh-machines-loading" @click=${() => { this.refreshCatalog(); }}>Refresh</button>
        </div>
      `;
    }
    if (catalog.kind === "error") return this.renderCatalogProblem("machine-error", catalog.message, "refresh-machines", "Refresh machines");
    if (catalog.kind === "empty") return this.renderCatalogProblem("machine-empty", "No machines are available.", "refresh-machines", "Refresh machines");
    const hasAvailableMachine = catalog.items.some(isMachineAvailable);
    return html`
      ${hasAvailableMachine ? nothing : this.renderCatalogProblem("machine-unavailable", "No machines are currently available.", "refresh-machines", "Refresh")}
      <ul class="catalog-list" aria-label="Machines">
        ${catalog.items.map((machine) => html`
          <li>
            <button class="catalog-item" type="button" data-machine-id=${machine.id} ?disabled=${!isMachineAvailable(machine)} @click=${() => { this.selectMachine(machine); }}>
              <span class="catalog-item-copy"><strong>${machine.name}</strong><small>${machine.statusMessage ?? machine.id}</small></span>
              <span class="catalog-meta">${machineAvailabilityLabel(machine)}</span>
            </button>
          </li>
        `)}
      </ul>
    `;
  }

  private renderProjects(machine: Machine, catalog: Extract<Extract<NewSessionComposerState, { kind: "choosing" }>["choice"], { step: "project" }>["catalog"]): TemplateResult {
    let body: TemplateResult;
    if (catalog.kind === "loading") body = html`<div class="catalog-state" data-state="project-loading" role="status"><p>Loading projects…</p><button type="button" data-action="refresh-projects-loading" @click=${() => { this.refreshCatalog(); }}>Refresh</button></div>`;
    else if (catalog.kind === "error") body = this.renderCatalogProblem("project-error", catalog.message, "refresh-projects", "Refresh projects");
    else if (catalog.kind === "empty") body = this.renderCatalogProblem("project-empty", `No projects are available on ${machine.name}.`, "refresh-projects", "Refresh projects");
    else {
      body = html`
        <ul class="catalog-list" aria-label="Projects">
          ${catalog.items.map((project) => html`
            <li>
              <button class="catalog-item" type="button" data-project-id=${project.id} @click=${() => { this.selectProject(project); }}>
                <span class="catalog-item-copy"><strong>${project.name}</strong><small>${project.path}</small></span><span aria-hidden="true">→</span>
              </button>
            </li>
          `)}
        </ul>
      `;
    }
    return html`${body}<div class="catalog-back"><button type="button" data-action="back-machine" @click=${() => { this.backToMachines(); }}>← Change machine</button></div>`;
  }

  private renderWorkspaces(machine: Machine, project: Project, catalog: Extract<Extract<NewSessionComposerState, { kind: "choosing" }>["choice"], { step: "workspace" }>["catalog"]): TemplateResult {
    let body: TemplateResult;
    if (catalog.kind === "loading") body = html`<div class="catalog-state" data-state="workspace-loading" role="status"><p>Loading workspaces…</p><button type="button" data-action="refresh-workspaces-loading" @click=${() => { this.refreshCatalog(); }}>Refresh</button></div>`;
    else if (catalog.kind === "error") body = this.renderCatalogProblem("workspace-error", catalog.message, "refresh-workspaces", "Refresh workspaces");
    else if (catalog.kind === "empty") body = this.renderCatalogProblem("workspace-empty", `No workspaces are available in ${project.name} on ${machine.name}.`, "refresh-workspaces", "Refresh workspaces");
    else {
      body = html`
        <ul class="catalog-list" aria-label="Workspaces">
          ${catalog.items.map((workspace) => html`
            <li>
              <button class="catalog-item" type="button" data-workspace-id=${workspace.id} @click=${() => { this.selectWorkspace(workspace); }}>
                <span class="catalog-item-copy"><strong>${workspace.label}${workspace.isMain ? " · main" : ""}</strong><small>${workspace.path}</small></span><span aria-hidden="true">→</span>
              </button>
            </li>
          `)}
        </ul>
      `;
    }
    return html`${body}<div class="catalog-back"><button type="button" data-action="back-project" @click=${() => { this.backToProjects(); }}>← Change project</button></div>`;
  }

  private renderCatalogProblem(stateName: string, message: string, action: string, actionLabel: string): TemplateResult {
    const error = stateName.endsWith("error");
    return html`
      <div class="catalog-state ${error ? "error" : ""}" data-state=${stateName} role=${error ? "alert" : "status"}>
        <p>${message}</p>
        <button type="button" data-action=${action} @click=${() => { this.refreshCatalog(); }}>${actionLabel}</button>
      </div>
    `;
  }

  private currentDestination(): NewSessionCompleteDestination | undefined {
    const state = this.composerState;
    return state.destination.kind === "complete" ? state.destination : undefined;
  }

  private replaceRuntimeForDestination(destination = this.composerState.destination): void {
    this.runtimeGeneration += 1;
    if (destination.kind !== "complete") {
      this.runtime = createPreSessionComposerRuntime({ machineId: "local" });
      return;
    }
    this.runtime = createPreSessionComposerRuntime({
      machineId: destination.machine.id,
      projectId: destination.project.id,
      workspaceId: destination.workspace.id,
    });
  }

  private placeholderForState(state: NewSessionComposerState): string {
    return state.destination.kind === "complete"
      ? "Describe the first task… Use / for prompt resources, @ for tracked files, @ space for all files"
      : "Describe the first task… Choose a destination to enable / and @ completions";
  }

  private footerSendAvailable(state: NewSessionComposerState): boolean {
    return state.kind === "editing"
      && state.destination.kind === "complete"
      && this.slashValidationError === undefined
      && (!this.draftDisplay.empty || this.draftDisplay.attachmentCount > 0);
  }

  private handleFooterSubmit(event: SubmitEvent): void {
    event.preventDefault();
    this.draft?.submit();
  }

  private async handleDraftSubmit(snapshot: ComposerDraftSubmitSnapshot): Promise<"accepted" | "rejected"> {
    const destination = this.currentDestination();
    if (destination === undefined) return "rejected";
    const runtimeGeneration = this.runtimeGeneration;
    const validated = await this.validatePromptResourceCommand(snapshot, destination);
    if (validated === undefined || runtimeGeneration !== this.runtimeGeneration) return "rejected";
    const next = beginNewSessionSubmission(this.composerState, validated);
    if (next.kind !== "submitting" || next === this.composerState) return "rejected";
    this.requestGeneration += 1;
    this.composerState = next;
    const callback = this.onSubmit;
    if (callback === undefined) {
      this.composerState = rejectNewSessionSubmission(next, { kind: "rejected", reason: "launch-rejected", message: "New session could not be started." });
      return "rejected";
    }
    try {
      const outcome = await callback({ destination: next.destination, firstPrompt: next.submission });
      if (!this.isConnected) return "rejected";
      if (outcome.kind === "accepted") return "accepted";
      this.composerState = rejectNewSessionSubmission(this.composerState, outcome);
      return "rejected";
    } catch (error) {
      if (this.isConnected) {
        this.composerState = rejectNewSessionSubmission(this.composerState, {
          kind: "rejected",
          reason: "launch-rejected",
          message: errorMessage(error),
        });
      }
      return "rejected";
    }
  }

  private async validatePromptResourceCommand(snapshot: ComposerDraftSubmitSnapshot, destination: NewSessionCompleteDestination): Promise<NewSessionFirstPromptSubmission | undefined> {
    const parsed = parseLeadingSlashCommand(snapshot.text);
    if ("kind" in parsed && parsed.kind === "not-command") return snapshot;
    if ("kind" in parsed) {
      this.slashValidationError = { message: "Enter a prompt resource command name after / before starting a session.", retryable: false };
      return undefined;
    }
    let catalog: PromptResourceCatalogResponse;
    try {
      catalog = await this.promptResourceCatalog(destination.project.id, destination.workspace.id, destination.machine.id);
    } catch (error) {
      this.slashValidationError = { message: errorMessage(error, "Prompt-resource catalog unavailable. Retry before sending a slash command."), retryable: true };
      return undefined;
    }
    if (!catalog.available) {
      this.slashValidationError = { message: catalog.message, retryable: true };
      return undefined;
    }
    const matches = catalog.commands.filter((command) => command.name === parsed.name);
    const match = matches[0];
    if (matches.length !== 1 || match === undefined) {
      this.slashValidationError = {
        message: matches.length === 0
          ? `/${parsed.name} is not available as a first-prompt command in this destination.`
          : `/${parsed.name} is ambiguous in this destination. Refresh resources and choose the command again.`,
        retryable: false,
      };
      return undefined;
    }
    this.slashValidationError = undefined;
    return { ...snapshot, promptResourceCommandIdentity: { ...match.identity } };
  }

  private clearValidationError(): void {
    if (this.slashValidationError !== undefined) this.slashValidationError = undefined;
  }

  private retryPromptResourceValidation(): void {
    this.clearValidationError();
    void this.updateComplete.then(() => { this.draft?.submit(); });
  }

  private openDestinationChoice(): void {
    const requestId = this.nextRequest();
    const next = startNewSessionDestinationChoice(this.composerState, requestId);
    if (next === this.composerState) return;
    this.composerState = next;
    void this.loadMachines(requestId);
  }

  private refreshCatalog(): void {
    if (this.composerState.kind !== "choosing") return;
    const previousChoice = this.composerState.choice;
    const requestId = this.nextRequest();
    this.composerState = refreshNewSessionCatalog(this.composerState, requestId);
    if (previousChoice.step === "machine") void this.loadMachines(requestId);
    else if (previousChoice.step === "project") void this.loadProjects(previousChoice.machine.id, requestId);
    else void this.loadWorkspaces(previousChoice.machine.id, previousChoice.project.id, requestId);
  }

  private selectMachine(machine: Machine): void {
    const requestId = this.requestGeneration + 1;
    const next = chooseNewSessionMachine(this.composerState, machine, requestId);
    if (next === this.composerState || next.kind !== "choosing" || next.choice.step !== "project") return;
    this.requestGeneration = requestId;
    this.composerState = next;
    void this.loadProjects(next.choice.machine.id, requestId);
  }

  private selectProject(project: Project): void {
    const requestId = this.requestGeneration + 1;
    const next = chooseNewSessionProject(this.composerState, project, requestId);
    if (next === this.composerState || next.kind !== "choosing" || next.choice.step !== "workspace") return;
    this.requestGeneration = requestId;
    this.composerState = next;
    void this.loadWorkspaces(next.choice.machine.id, next.choice.project.id, requestId);
  }

  private selectWorkspace(workspace: Workspace): void {
    const next = chooseNewSessionWorkspace(this.composerState, workspace);
    if (next === this.composerState) return;
    this.requestGeneration += 1;
    this.composerState = next;
    this.clearValidationError();
    this.replaceRuntimeForDestination(next.destination);
  }

  private backToMachines(): void {
    if (this.composerState.kind !== "choosing" || this.composerState.choice.step !== "project") return;
    const requestId = this.nextRequest();
    this.composerState = backToMachineChoice(this.composerState, requestId);
    void this.loadMachines(requestId);
  }

  private backToProjects(): void {
    if (this.composerState.kind !== "choosing" || this.composerState.choice.step !== "workspace") return;
    const machineId = this.composerState.choice.machine.id;
    const requestId = this.nextRequest();
    this.composerState = backToProjectChoice(this.composerState, requestId);
    void this.loadProjects(machineId, requestId);
  }

  private async loadMachines(requestId: number): Promise<void> {
    try {
      const items = await this.catalog.loadMachines();
      this.resolveIfCurrent(requestId, () => resolveNewSessionMachines(this.composerState, requestId, { kind: "ready", items }));
    } catch (error) {
      this.resolveIfCurrent(requestId, () => resolveNewSessionMachines(this.composerState, requestId, { kind: "error", message: errorMessage(error, "The destination catalog could not be loaded.") }));
    }
  }

  private async loadProjects(machineId: string, requestId: number): Promise<void> {
    try {
      const items = await this.catalog.loadProjects(machineId);
      this.resolveIfCurrent(requestId, () => resolveNewSessionProjects(this.composerState, requestId, { kind: "ready", items }));
    } catch (error) {
      this.resolveIfCurrent(requestId, () => resolveNewSessionProjects(this.composerState, requestId, { kind: "error", message: errorMessage(error, "The destination catalog could not be loaded.") }));
    }
  }

  private async loadWorkspaces(machineId: string, projectId: string, requestId: number): Promise<void> {
    try {
      const items = await this.catalog.loadWorkspaces(machineId, projectId);
      this.resolveIfCurrent(requestId, () => resolveNewSessionWorkspaces(this.composerState, requestId, { kind: "ready", items }));
    } catch (error) {
      this.resolveIfCurrent(requestId, () => resolveNewSessionWorkspaces(this.composerState, requestId, { kind: "error", message: errorMessage(error, "The destination catalog could not be loaded.") }));
    }
  }

  private resolveIfCurrent(requestId: number, resolve: () => NewSessionComposerState): void {
    if (!this.isConnected || requestId !== this.requestGeneration) return;
    this.composerState = resolve();
  }

  private nextRequest(): number {
    this.requestGeneration += 1;
    return this.requestGeneration;
  }

  private requestCancel(): void {
    if (this.composerState.kind === "submitting") return;
    this.requestGeneration += 1;
    this.returnClaimedRecoveryDraft();
    this.draft?.discardDraft();
    this.onCancel?.();
  }

  private claimRecoveryDraftOnce(): void {
    const seedId = this.recoverySeedId;
    if (seedId === undefined || seedId === this.claimedRecoverySeedId || this.draft === undefined || this.onClaimRecoveryDraft === undefined) return;
    this.claimedRecoverySeedId = seedId;
    const seed = this.onClaimRecoveryDraft(seedId);
    this.claimedRecoveryPromptResourceCommandIdentity = seed?.snapshot.promptResourceCommandIdentity;
    if (seed !== undefined) this.draft.restoreSeed(seed);
  }

  private returnClaimedRecoveryDraft(): void {
    const seedId = this.claimedRecoverySeedId;
    const draft = this.draft;
    if (seedId === undefined || draft === undefined || this.onReturnRecoveryDraft === undefined) return;
    const snapshot = draft.currentSnapshot();
    const identity = this.claimedRecoveryPromptResourceCommandIdentity;
    this.onReturnRecoveryDraft(seedId, {
      ...snapshot,
      ...(identity !== undefined && promptResourceIdentityApplies(snapshot.text, identity) ? { promptResourceCommandIdentity: { ...identity } } : {}),
    });
    this.claimedRecoveryPromptResourceCommandIdentity = undefined;
  }

  private focusCurrentRegion(): void {
    if (this.composerState.kind === "editing" && this.composerState.destination.kind === "complete") {
      this.draft?.focusInput();
      return;
    }
    this.modalSurface?.focusDialog();
  }

  static override styles = newSessionComposerStyles;
}

function stateFocusRegion(state: NewSessionComposerState): string {
  return state.kind === "choosing" ? `choosing:${state.choice.step}` : state.kind;
}

function initialFocusSelector(state: NewSessionComposerState): string {
  if (state.kind === "choosing") return "[data-chooser-primary]";
  if (state.kind === "editing" && state.destination.kind === "required") return "[data-action='change-destination']";
  return "composer-draft";
}

function isMachineAvailable(machine: Machine): boolean {
  return machine.status !== "offline" && machine.status !== "error";
}

function machineAvailabilityLabel(machine: Machine): string {
  if (machine.status === "offline") return "Offline";
  if (machine.status === "error") return "Unavailable";
  if (machine.status === "online") return "Online";
  return "Status unknown";
}

function promptResourceIdentityApplies(text: string, identity: NewSessionFirstPromptSubmission["promptResourceCommandIdentity"]): boolean {
  if (identity === undefined) return false;
  const parsed = parseLeadingSlashCommand(text);
  return !("kind" in parsed) && parsed.name === identity.name;
}

function errorMessage(error: unknown, fallback = "New session could not be started."): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}
