import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { PromptResourceCatalogResponse } from "../../../shared/promptResourceCommand";
import { parseLeadingSlashCommand } from "../../../shared/promptResourceCommand";
import { workspacesApi, type Machine, type Project, type Workspace } from "../api";
import { createPreSessionComposerRuntime, type ComposerRuntime } from "../composerRuntime";
import type { ComposerCapabilities } from "../composerCapabilities";
import type { NewSessionAgentChoices, SessionModel as ClientSessionModel } from "../../../shared/apiTypes";
import { KNOWN_THINKING_LEVELS } from "../../../shared/thinkingLevels";
import { setSessionGuidance } from "../../../shared/sessionGuidance";
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
  isNewSessionMachineAvailable,
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
import "./PromptEditor";
import type { PromptEditor } from "./PromptEditor";
import type { ComposerDraft, ComposerDraftDisplayState, ComposerDraftSeed, ComposerDraftSubmitSnapshot } from "./ComposerDraft";
import "./ModalSurface";
import { newSessionComposerStyles } from "./shared";

interface SlashValidationError {
  readonly message: string;
  readonly retryable: boolean;
}

type SlashValidationResult =
  | { readonly kind: "valid"; readonly submission: NewSessionFirstPromptSubmission }
  | { readonly kind: "invalid"; readonly error: SlashValidationError };

@customElement("new-session-composer")
export class NewSessionComposer extends LitElement {
  /** Initial values are read once. Later property updates never replace the mounted local draft. */
  @property({ attribute: false }) initialDestination?: NewSessionCompleteDestination;
  @property({ attribute: false }) recoverySeedId?: string;
  @property({ attribute: false }) catalog: NewSessionDestinationCatalog = createApiNewSessionDestinationCatalog();
  @property({ attribute: false }) onCancel?: () => void;
  @property({ attribute: false }) onSubmit?: (intent: NewSessionLaunchIntent) => Promise<NewSessionSubmissionOutcome> | NewSessionSubmissionOutcome;
  @property({ attribute: false }) onClaimRecoveryDraft?: (recoverySeedId: string) => ComposerDraftSeed | undefined;
  @property({ attribute: false }) onReturnRecoveryDraft?: (recoverySeedId: string, snapshot: ComposerDraftSubmitSnapshot) => void;
  @property({ attribute: false }) promptResourceCatalog: (projectId: string, workspaceId: string, machineId: string) => Promise<PromptResourceCatalogResponse> = (projectId, workspaceId, machineId) => workspacesApi.promptResourceCatalog(projectId, workspaceId, machineId);

  @state() private composerState: NewSessionComposerState = createNewSessionComposerState();
  @state() private draftDisplay: ComposerDraftDisplayState = { inputMode: { kind: "normal" }, empty: true, focused: false, attachmentCount: 0, attachmentCapturePending: false };
  @state() private slashValidationError: SlashValidationError | undefined;
  @state() private validationPending = false;
  @query("modal-surface") private modalSurface?: ModalSurface;
  @query("prompt-editor") private editor?: PromptEditor;
  private draftWaitScheduled = false;
  /** Opened by the host, which owns the pickers the chat already uses. */
  @property({ attribute: false }) onPickModel?: (current: ClientSessionModel | undefined) => Promise<ClientSessionModel | undefined>;
  @property({ attribute: false }) onPickThinkingLevel?: (current: string | undefined) => Promise<string | undefined>;
  /** Model, thinking, and guidance picked before the session exists. */
  @state() private chosenModel?: ClientSessionModel;
  @state() private chosenThinkingLevel?: string;
  @state() private chosenGuidanceIds: readonly string[] = [];
  @state() private availableModels: readonly ClientSessionModel[] = [];

  /** The modal drives the same shared draft the chat composer drives. */
  private get draft(): ComposerDraft | undefined {
    return this.editor?.draft;
  }

  private initialized = false;
  private requestGeneration = 0;
  private runtimeGeneration = 0;
  private submissionGeneration = 0;
  private focusRegion = "";
  private runtime: ComposerRuntime = createPreSessionComposerRuntime({ machineId: "local" });
  private claimedRecoverySeedId: string | undefined;
  private completedRecoverySeedId: string | undefined;
  private recoveryClaimRetryScheduled = false;
  private recoveryClaimRetryAttemptedFor: string | undefined;
  private connectionGeneration = 0;

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

  override connectedCallback(): void {
    this.connectionGeneration += 1;
    super.connectedCallback();
  }

  override disconnectedCallback(): void {
    this.requestGeneration += 1;
    this.runtimeGeneration += 1;
    this.submissionGeneration += 1;
    this.validationPending = false;
    const generation = ++this.connectionGeneration;
    queueMicrotask(() => { void this.returnDisconnectedRecoveryDraftWhenSettled(generation); });
    super.disconnectedCallback();
  }

  /** Refocuses this mounted composer without replacing its destination or draft. */
  focusExisting(): void {
    this.focusCurrentRegion();
  }

  override render(): TemplateResult {
    const state = this.composerState;
    const submitting = state.kind === "submitting";
    const attachmentCapturePending = this.draftDisplay.attachmentCapturePending;
    const busy = submitting || this.validationPending || attachmentCapturePending;
    return html`
      <modal-surface
        .label=${"New session"}
        .initialFocus=${initialFocusSelector(state)}
        .busy=${busy}
        .onClose=${() => { this.requestCancel(); }}
      >
        <div class="composer">
          ${state.kind !== "choosing" ? nothing : html`
            <section class="destination-choice" aria-labelledby="new-session-destination-label">
              <h2 class="field-label" id="new-session-destination-label">Destination</h2>
              ${this.renderDestinationChoice(state)}
            </section>
          `}
          <!-- The composer stays mounted while a destination is chosen, so the
               first prompt and its attachments survive the choice. -->
          <prompt-editor
              aria-label="First prompt"
              data-field="prompt"
              .capabilities=${this.composerCapabilities(state)}
              .editorLabel=${"First prompt"}
              .placeholderText=${this.placeholderForState(state)}
              .composerRuntime=${this.runtime}
              .disabled=${submitting}
              .sending=${submitting || this.validationPending}
              .submissionAvailable=${this.composerDraftAvailable()}
              .sendAvailable=${this.composerSendAvailable(state)}
              .onDraftSubmit=${(snapshot: ComposerDraftSubmitSnapshot) => this.handleDraftSubmit(snapshot)}
              .onDraftDisplayStateChange=${(display: ComposerDraftDisplayState) => { this.draftDisplay = display; }}
              .onDraftEdited=${() => { this.invalidatePendingSubmission(); this.clearValidationError(); }}
              .onCompletionError=${() => { this.clearValidationError(); }}
            ></prompt-editor>

          ${this.slashValidationError === undefined ? nothing : html`
            <div class="submission-error" role="alert">
              <p>${this.slashValidationError.message}</p>
              ${this.slashValidationError.retryable ? html`<button type="button" data-action="retry-prompt-resource-validation" @click=${() => { this.retryPromptResourceValidation(); }}>Retry</button>` : nothing}
            </div>
          `}
          ${state.kind === "editing" && state.submissionError !== undefined
            ? html`<p class="submission-error" role="alert">${state.submissionError.message}</p>`
            : nothing}
          ${busy ? html`<span class="busy-label" role="status">${attachmentCapturePending ? "Attaching files…" : this.validationPending ? "Validating prompt…" : "Starting session…"}</span>` : nothing}
          <button class="composer-cancel" type="button" data-action="cancel" ?disabled=${submitting || attachmentCapturePending} @click=${() => { this.requestCancel(); }}>Cancel</button>
        </div>
      </modal-surface>
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
    const hasAvailableMachine = catalog.items.some(isNewSessionMachineAvailable);
    return html`
      ${hasAvailableMachine ? nothing : this.renderCatalogProblem("machine-unavailable", "No machines are currently available.", "refresh-machines", "Refresh")}
      <ul class="catalog-list" aria-label="Machines">
        ${catalog.items.map((machine) => html`
          <li>
            <button class="catalog-item" type="button" data-machine-id=${machine.id} ?disabled=${!isNewSessionMachineAvailable(machine)} @click=${() => { this.selectMachine(machine); }}>
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
      promptResourceCatalog: this.promptResourceCatalog,
    });
  }

  private placeholderForState(state: NewSessionComposerState): string {
    return state.destination.kind === "complete"
      ? "Describe the first task… Use / for prompt resources, @ for tracked files, @ space for all files"
      : "Describe the first task… Choose a destination to enable / and @ completions";
  }

  /**
   * What the new-session composer can do.
   *
   * The destination is stated in the composer's own row and carries the action
   * that changes it, so the modal does not need a field of its own for it.
   */
  private composerCapabilities(state: NewSessionComposerState): ComposerCapabilities {
    const destination = state.kind === "choosing" ? undefined : state.destination;
    const chosen = destination?.kind === "complete" ? destination : undefined;
    const label = chosen === undefined
      ? "Destination required"
      : `${chosen.project.name} · ${chosen.workspace.label} · ${chosen.machine.name}`;
    return {
      context: [{
        id: "destination",
        label,
        title: label,
        action: {
          label: chosen === undefined ? "Choose" : "Change",
          disabled: state.kind === "submitting",
          onActivate: () => { this.openDestinationChoice(); },
        },
      }],
      model: {
        ...(this.chosenModel === undefined ? {} : { model: this.chosenModel }),
        ...(this.chosenThinkingLevel === undefined ? {} : { thinkingLevel: this.chosenThinkingLevel }),
        availableThinkingLevels: KNOWN_THINKING_LEVELS,
        changeable: state.kind !== "submitting",
        onSelectModel: () => { void this.chooseModel(); },
        onSelectThinking: () => { this.chooseThinkingLevel(); },
      },
      guidance: {
        activeIds: this.chosenGuidanceIds,
        changeable: state.kind !== "submitting",
        onSet: (entryId: string, enabled: boolean) => {
          this.chosenGuidanceIds = setSessionGuidance(this.chosenGuidanceIds, entryId, enabled).activeIds;
          return Promise.resolve(true);
        },
      },
    };
  }

  /**
   * Whether the composer may submit.
   *
   * This gate also stops the draft mutating, so it must not include a missing
   * destination: you may attach files and write a first prompt before you have
   * chosen where to run it. An incomplete destination is refused by the submit
   * handler instead, which keeps the draft intact.
   */
  private composerSendAvailable(state: NewSessionComposerState): boolean {
    return state.kind === "editing"
      && state.destination.kind === "complete"
      && !this.draftDisplay.attachmentCapturePending;
  }

  private async chooseModel(): Promise<void> {
    const picked = await this.onPickModel?.(this.chosenModel);
    if (picked !== undefined) this.chosenModel = picked;
  }

  private chooseThinkingLevel(): void {
    void this.onPickThinkingLevel?.(this.chosenThinkingLevel).then((picked) => {
      if (picked !== undefined) this.chosenThinkingLevel = picked;
    });
  }

  /** What the author picked before the session existed, stated for creation. */
  private agentChoices(): NewSessionAgentChoices | undefined {
    const modelSpec = this.chosenModel?.provider !== undefined && this.chosenModel.id !== undefined
      ? `${this.chosenModel.provider}/${this.chosenModel.id}`
      : undefined;
    const choices: NewSessionAgentChoices = {
      ...(modelSpec === undefined ? {} : { modelSpec }),
      ...(this.chosenThinkingLevel === undefined ? {} : { thinkingLevel: this.chosenThinkingLevel }),
      ...(this.chosenGuidanceIds.length === 0 ? {} : { guidanceIds: this.chosenGuidanceIds }),
    };
    return Object.keys(choices).length === 0 ? undefined : choices;
  }

  /** Blocks the draft itself, so it stays clear of destination questions. */
  private composerDraftAvailable(): boolean {
    return this.slashValidationError === undefined && !this.validationPending;
  }

  private handleFooterSubmit(event: SubmitEvent): void {
    event.preventDefault();
    this.draft?.submit();
  }

  private async handleDraftSubmit(snapshot: ComposerDraftSubmitSnapshot): Promise<"accepted" | "rejected"> {
    if (this.validationPending) return "rejected";
    const destination = this.currentDestination();
    if (destination === undefined) return "rejected";
    const runtimeGeneration = this.runtimeGeneration;
    const submissionGeneration = ++this.submissionGeneration;
    this.validationPending = true;
    const validation = await this.validatePromptResourceCommand(snapshot, destination);
    if (!this.submissionIsCurrent(submissionGeneration, runtimeGeneration)) return "rejected";
    this.validationPending = false;
    if (validation.kind === "invalid") {
      this.slashValidationError = validation.error;
      return "rejected";
    }
    const next = beginNewSessionSubmission(this.composerState, validation.submission);
    if (next.kind !== "submitting" || next === this.composerState) return "rejected";
    this.requestGeneration += 1;
    this.composerState = next;
    const callback = this.onSubmit;
    if (callback === undefined) {
      this.composerState = rejectNewSessionSubmission(next, { kind: "rejected", reason: "launch-rejected", message: "New session could not be started." });
      return "rejected";
    }
    try {
      const agentChoices = this.agentChoices();
      const outcome = await callback({
        destination: next.destination,
        firstPrompt: validation.submission,
        ...(agentChoices === undefined ? {} : { agentChoices }),
      });
      if (!this.submissionIsCurrent(submissionGeneration, runtimeGeneration)) return "rejected";
      if (outcome.kind === "accepted") {
        this.completedRecoverySeedId = this.claimedRecoverySeedId;
        this.claimedRecoverySeedId = undefined;
        return "accepted";
      }
      this.composerState = rejectNewSessionSubmission(this.composerState, outcome);
      return "rejected";
    } catch (error) {
      if (this.submissionIsCurrent(submissionGeneration, runtimeGeneration)) {
        this.composerState = rejectNewSessionSubmission(this.composerState, {
          kind: "rejected",
          reason: "launch-rejected",
          message: errorMessage(error),
        });
      }
      return "rejected";
    }
  }

  private async validatePromptResourceCommand(snapshot: ComposerDraftSubmitSnapshot, destination: NewSessionCompleteDestination): Promise<SlashValidationResult> {
    const parsed = parseLeadingSlashCommand(snapshot.text);
    if (parsed.kind === "not-command") return { kind: "valid", submission: snapshot };
    if (parsed.kind !== "command") {
      return { kind: "invalid", error: { message: "Enter a prompt resource command name after / before starting a session.", retryable: false } };
    }
    let catalog: PromptResourceCatalogResponse;
    try {
      catalog = await this.promptResourceCatalog(destination.project.id, destination.workspace.id, destination.machine.id);
    } catch (error) {
      return { kind: "invalid", error: { message: errorMessage(error, "Prompt-resource catalog unavailable. Retry before sending a slash command."), retryable: true } };
    }
    if (!catalog.available) return { kind: "invalid", error: { message: catalog.message, retryable: true } };
    const matches = catalog.commands.filter((command) => command.name === parsed.name);
    const match = matches[0];
    if (matches.length !== 1 || match === undefined) {
      return {
        kind: "invalid",
        error: {
          message: matches.length === 0
            ? `/${parsed.name} is not available as a first-prompt command in this destination.`
            : `/${parsed.name} is ambiguous in this destination. Refresh resources and choose the command again.`,
          retryable: false,
        },
      };
    }
    return { kind: "valid", submission: { ...snapshot, promptResourceCommandIdentity: { ...match.identity } } };
  }

  private clearValidationError(): void {
    if (this.slashValidationError !== undefined) this.slashValidationError = undefined;
  }

  private retryPromptResourceValidation(): void {
    this.clearValidationError();
    void this.updateComplete.then(() => { this.draft?.submit(); });
  }

  private openDestinationChoice(): void {
    this.invalidatePendingSubmission();
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
    if (this.composerState.kind === "submitting" || this.draftDisplay.attachmentCapturePending) return;
    this.requestGeneration += 1;
    this.invalidatePendingSubmission();
    this.returnClaimedRecoveryDraft();
    this.draft?.discardDraft();
    this.onCancel?.();
  }

  private submissionIsCurrent(submissionGeneration: number, runtimeGeneration: number): boolean {
    return this.isConnected
      && submissionGeneration === this.submissionGeneration
      && runtimeGeneration === this.runtimeGeneration;
  }

  private invalidatePendingSubmission(): void {
    this.submissionGeneration += 1;
    this.validationPending = false;
  }

  private claimRecoveryDraftOnce(): void {
    const seedId = this.recoverySeedId;
    if (seedId === undefined || seedId === this.claimedRecoverySeedId || seedId === this.completedRecoverySeedId || this.onClaimRecoveryDraft === undefined) return;
    if (this.draft === undefined) {
      // The composer renders its own draft, so the draft appears one update
      // after this element does. Wait for it rather than dropping the claim.
      this.awaitDraftForRecoveryClaim();
      return;
    }
    const seed = this.onClaimRecoveryDraft(seedId);
    if (seed !== undefined) {
      this.claimedRecoverySeedId = seedId;
      this.recoveryClaimRetryAttemptedFor = undefined;
      this.draft.restoreSeed(seed);
      return;
    }
    if (this.recoveryClaimRetryScheduled || this.recoveryClaimRetryAttemptedFor === seedId) return;
    this.recoveryClaimRetryScheduled = true;
    this.recoveryClaimRetryAttemptedFor = seedId;
    queueMicrotask(() => {
      this.recoveryClaimRetryScheduled = false;
      if (this.isConnected) this.claimRecoveryDraftOnce();
    });
  }

  private awaitDraftForRecoveryClaim(): void {
    const editor = this.editor;
    if (editor === undefined || this.draftWaitScheduled) return;
    this.draftWaitScheduled = true;
    void editor.updateComplete.then(() => {
      this.draftWaitScheduled = false;
      if (this.isConnected) this.claimRecoveryDraftOnce();
    });
  }

  private async returnDisconnectedRecoveryDraftWhenSettled(generation: number): Promise<void> {
    if (this.draftDisplay.attachmentCapturePending) await this.draft?.retainPendingAttachmentCaptureAfterDisconnect();
    if (!this.isConnected && generation === this.connectionGeneration) this.returnClaimedRecoveryDraft();
  }

  private returnClaimedRecoveryDraft(): void {
    const seedId = this.claimedRecoverySeedId;
    const draft = this.draft;
    if (seedId === undefined || draft === undefined || this.onReturnRecoveryDraft === undefined) return;
    this.claimedRecoverySeedId = undefined;
    this.onReturnRecoveryDraft(seedId, draft.currentSnapshot());
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
  return "prompt-editor";
}

function machineAvailabilityLabel(machine: Machine): string {
  if (machine.status === "offline") return "Offline";
  if (machine.status === "error") return "Unavailable";
  if (machine.status === "online") return "Online";
  return "Status unknown";
}

function errorMessage(error: unknown, fallback = "New session could not be started."): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}
