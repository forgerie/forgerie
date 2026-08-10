import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { Machine, Project, Workspace } from "../api";
import {
  backToMachineChoice,
  backToProjectChoice,
  beginNewSessionSubmission,
  canSubmitNewSession,
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
  updateNewSessionPrompt,
  type NewSessionCompleteDestination,
  type NewSessionComposerState,
  type NewSessionDestinationCatalog,
  type NewSessionLaunchIntent,
  type NewSessionSubmissionOutcome,
} from "../newSessionComposer";
import type { ModalSurface } from "./ModalSurface";
import "./ModalSurface";
import { newSessionComposerStyles } from "./shared";

@customElement("new-session-composer")
export class NewSessionComposer extends LitElement {
  /** Initial values are read once. Later property updates never replace the mounted local draft. */
  @property({ attribute: false }) initialDestination?: NewSessionCompleteDestination;
  @property({ attribute: false }) initialPrompt = "";
  @property({ attribute: false }) catalog: NewSessionDestinationCatalog = createApiNewSessionDestinationCatalog();
  @property({ attribute: false }) onCancel?: () => void;
  @property({ attribute: false }) onSubmit?: (intent: NewSessionLaunchIntent) => Promise<NewSessionSubmissionOutcome> | NewSessionSubmissionOutcome;

  @state() private composerState: NewSessionComposerState = createNewSessionComposerState();
  @query("modal-surface") private modalSurface?: ModalSurface;

  private initialized = false;
  private requestGeneration = 0;
  private focusRegion = "";

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    if (this.initialized) return;
    this.initialized = true;
    this.composerState = createNewSessionComposerState(this.initialDestination, this.initialPrompt);
  }

  protected override updated(): void {
    const focusRegion = stateFocusRegion(this.composerState);
    if (focusRegion === this.focusRegion) return;
    this.focusRegion = focusRegion;
    this.modalSurface?.focusDialog();
  }

  override disconnectedCallback(): void {
    this.requestGeneration += 1;
    super.disconnectedCallback();
  }

  /** Refocuses this mounted composer without replacing its destination or draft. */
  focusExisting(): void {
    this.modalSurface?.focusDialog();
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
        <form class="composer" @submit=${(event: SubmitEvent) => { this.handleSubmit(event); }}>
          <header class="dialog-header">
            <h1>New session</h1>
            <button
              class="icon-button"
              type="button"
              data-action="close"
              aria-label="Close New session"
              title="Close"
              ?disabled=${submitting}
              @click=${() => { this.requestCancel(); }}
            >×</button>
          </header>

          <div class="dialog-scroll">
            <section class="field" aria-labelledby="new-session-destination-label">
              <h2 class="field-label" id="new-session-destination-label">Destination</h2>
              ${state.kind === "choosing" ? this.renderDestinationChoice(state) : this.renderDestinationSummary(state)}
            </section>

            <section class="field">
              <label class="field-label" for="new-session-prompt">First prompt</label>
              <textarea
                id="new-session-prompt"
                data-field="prompt"
                aria-label="First prompt"
                .value=${state.prompt}
                ?disabled=${submitting}
                @input=${(event: InputEvent) => { this.updatePrompt(event); }}
              ></textarea>
            </section>

            ${state.kind === "editing" && state.submissionError !== undefined
              ? html`<p class="submission-error" role="alert">${state.submissionError.message}</p>`
              : nothing}
          </div>

          <footer class="dialog-footer">
            ${submitting ? html`<span class="busy-label" role="status">Checking destination…</span>` : nothing}
            <button type="button" data-action="cancel" ?disabled=${submitting} @click=${() => { this.requestCancel(); }}>Cancel</button>
            <button class="primary" type="submit" data-action="send" ?disabled=${!canSubmitNewSession(state)}>${submitting ? "Sending…" : "Send"}</button>
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
                <strong>${destination.project.name} · ${destination.workspace.label}</strong>
                <span>${destination.machine.name} · ${machineAvailabilityLabel(destination.machine)}</span>
                <small>${destination.workspace.path}</small>
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
    if (catalog.kind === "error") {
      return this.renderCatalogProblem("machine-error", catalog.message, "refresh-machines", "Refresh machines");
    }
    if (catalog.kind === "empty") {
      return this.renderCatalogProblem("machine-empty", "No machines are available.", "refresh-machines", "Refresh machines");
    }
    const hasAvailableMachine = catalog.items.some(isMachineAvailable);
    return html`
      ${hasAvailableMachine
        ? nothing
        : this.renderCatalogProblem("machine-unavailable", "No machines are currently available.", "refresh-machines", "Refresh")}
      <ul class="catalog-list" aria-label="Machines">
        ${catalog.items.map((machine) => html`
          <li>
            <button
              class="catalog-item"
              type="button"
              data-machine-id=${machine.id}
              ?disabled=${!isMachineAvailable(machine)}
              @click=${() => { this.selectMachine(machine); }}
            >
              <span class="catalog-item-copy"><strong>${machine.name}</strong><small>${machine.statusMessage ?? machine.id}</small></span>
              <span class="catalog-meta">${machineAvailabilityLabel(machine)}</span>
            </button>
          </li>
        `)}
      </ul>
    `;
  }

  private renderProjects(
    machine: Machine,
    catalog: Extract<Extract<NewSessionComposerState, { kind: "choosing" }>["choice"], { step: "project" }>["catalog"],
  ): TemplateResult {
    let body: TemplateResult;
    if (catalog.kind === "loading") {
      body = html`<div class="catalog-state" data-state="project-loading" role="status"><p>Loading projects…</p><button type="button" data-action="refresh-projects-loading" @click=${() => { this.refreshCatalog(); }}>Refresh</button></div>`;
    } else if (catalog.kind === "error") {
      body = this.renderCatalogProblem("project-error", catalog.message, "refresh-projects", "Refresh projects");
    } else if (catalog.kind === "empty") {
      body = this.renderCatalogProblem("project-empty", `No projects are available on ${machine.name}.`, "refresh-projects", "Refresh projects");
    } else {
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

  private renderWorkspaces(
    machine: Machine,
    project: Project,
    catalog: Extract<Extract<NewSessionComposerState, { kind: "choosing" }>["choice"], { step: "workspace" }>["catalog"],
  ): TemplateResult {
    let body: TemplateResult;
    if (catalog.kind === "loading") {
      body = html`<div class="catalog-state" data-state="workspace-loading" role="status"><p>Loading workspaces…</p><button type="button" data-action="refresh-workspaces-loading" @click=${() => { this.refreshCatalog(); }}>Refresh</button></div>`;
    } else if (catalog.kind === "error") {
      body = this.renderCatalogProblem("workspace-error", catalog.message, "refresh-workspaces", "Refresh workspaces");
    } else if (catalog.kind === "empty") {
      body = this.renderCatalogProblem("workspace-empty", `No workspaces are available in ${project.name} on ${machine.name}.`, "refresh-workspaces", "Refresh workspaces");
    } else {
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

  private updatePrompt(event: InputEvent): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLTextAreaElement)) return;
    this.composerState = updateNewSessionPrompt(this.composerState, target.value);
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
      this.resolveIfCurrent(requestId, () => resolveNewSessionMachines(this.composerState, requestId, { kind: "error", message: errorMessage(error) }));
    }
  }

  private async loadProjects(machineId: string, requestId: number): Promise<void> {
    try {
      const items = await this.catalog.loadProjects(machineId);
      this.resolveIfCurrent(requestId, () => resolveNewSessionProjects(this.composerState, requestId, { kind: "ready", items }));
    } catch (error) {
      this.resolveIfCurrent(requestId, () => resolveNewSessionProjects(this.composerState, requestId, { kind: "error", message: errorMessage(error) }));
    }
  }

  private async loadWorkspaces(machineId: string, projectId: string, requestId: number): Promise<void> {
    try {
      const items = await this.catalog.loadWorkspaces(machineId, projectId);
      this.resolveIfCurrent(requestId, () => resolveNewSessionWorkspaces(this.composerState, requestId, { kind: "ready", items }));
    } catch (error) {
      this.resolveIfCurrent(requestId, () => resolveNewSessionWorkspaces(this.composerState, requestId, { kind: "error", message: errorMessage(error) }));
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
    this.onCancel?.();
  }

  private handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const next = beginNewSessionSubmission(this.composerState);
    if (next.kind !== "submitting" || next === this.composerState) return;
    this.requestGeneration += 1;
    this.composerState = next;
    const callback = this.onSubmit;
    if (callback === undefined) {
      this.composerState = rejectNewSessionSubmission(next, { kind: "rejected", reason: "launch-rejected", message: "New session could not be started." });
      return;
    }
    void this.submitToRoot(callback, next);
  }

  private async submitToRoot(
    callback: NonNullable<NewSessionComposer["onSubmit"]>,
    state: Extract<NewSessionComposerState, { kind: "submitting" }>,
  ): Promise<void> {
    try {
      const outcome = await callback({ destination: state.destination, prompt: state.prompt });
      if (!this.isConnected || outcome.kind === "accepted") return;
      this.composerState = rejectNewSessionSubmission(this.composerState, outcome);
    } catch (error) {
      if (!this.isConnected) return;
      this.composerState = rejectNewSessionSubmission(this.composerState, {
        kind: "rejected",
        reason: "launch-rejected",
        message: errorMessage(error),
      });
    }
  }

  static override styles = newSessionComposerStyles;
}

function stateFocusRegion(state: NewSessionComposerState): string {
  return state.kind === "choosing" ? `choosing:${state.choice.step}` : state.kind;
}

function initialFocusSelector(state: NewSessionComposerState): string {
  if (state.kind === "choosing") return "[data-chooser-primary]";
  if (state.kind === "editing" && state.destination.kind === "required") return "[data-action='change-destination']";
  return "[data-field='prompt']";
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

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "The destination catalog could not be loaded.";
}
