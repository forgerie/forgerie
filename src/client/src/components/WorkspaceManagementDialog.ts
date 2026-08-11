/**
 * Workspace/project picker retained for workspace management.
 * Session creation is owned by NewSessionComposer.
 *
 * State discipline:
 *   All step/loading/error state is owned by the parent (PiWebApp) via
 *   the `dialogState` property.  This component is purely presentational and
 *   fires callbacks for every user interaction.
 *
 * Touch targets: All interactive elements are keyed with `data-project-id`,
 * `data-workspace-id`, `data-action`, etc., and receive `min-height: 44px`
 * via the CSS rules below.
 */

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Project, Workspace } from "../api";
import type { WorkspaceManagementDialogState } from "../appState";
import "./ModalSurface";

@customElement("workspace-management-dialog")
export class WorkspaceManagementDialog extends LitElement {
  /** When `undefined` the element renders nothing (dialog is closed). */
  @property({ attribute: false }) dialogState: WorkspaceManagementDialogState | undefined;
  /** Full project list from the machine; shown on the project step. */
  @property({ attribute: false }) projects: Project[] = [];

  // Callbacks — all optional; the parent wires only those it needs.
  /** Called when the user picks a project on the project step. */
  @property({ attribute: false }) onSelectProject?: (project: Project) => void;
  /** Called when the user chooses the workspace to manage. */
  @property({ attribute: false }) onConfirmManage?: (workspace: Workspace) => void;
  /** Called when the user navigates back from workspace to project step. */
  @property({ attribute: false }) onBack?: () => void;
  /** Called when the user dismisses the dialog without confirming. */
  @property({ attribute: false }) onCancel?: () => void;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  override render() {
    const state = this.dialogState;
    if (state === undefined) return nothing;

    const title = "Manage workspace";

    return html`
      <modal-surface
        .onClose=${() => { this.onCancel?.(); }}
        .label=${title}
      >
        <header class="dialog-header">
          <strong data-dialog-title>${title}</strong>
          <button
            class="icon-btn"
            data-action="cancel"
            title="Close"
            aria-label="Close dialog"
            @click=${() => { this.onCancel?.(); }}
          >×</button>
        </header>
        ${state.step === "project"
          ? this.renderProjectStep()
          : this.renderWorkspaceStep(state)}
      </modal-surface>
    `;
  }

  // -------------------------------------------------------------------------
  // Project step
  // -------------------------------------------------------------------------

  private renderProjectStep() {
    return html`
      <div class="step" data-step="project">
        <p class="step-prompt">Choose a project:</p>
        ${this.projects.length === 0
          ? html`
              <div class="empty-state" data-empty-projects>
                No projects found. Add a project first.
              </div>
            `
          : html`
              <div class="item-list" role="listbox" aria-label="Projects">
                ${this.projects.map((project) => html`
                  <button
                    class="item-btn"
                    role="option"
                    data-project-id=${project.id}
                    title=${project.path}
                    @click=${() => { this.onSelectProject?.(project); }}
                  >
                    <span class="item-primary">${project.name}</span>
                    <span class="item-secondary">${project.path}</span>
                  </button>
                `)}
              </div>
            `}
        <footer class="dialog-footer">
          <button
            class="footer-btn"
            data-action="cancel"
            @click=${() => { this.onCancel?.(); }}
          >Cancel</button>
        </footer>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // Workspace step
  // -------------------------------------------------------------------------

  private renderWorkspaceStep(
    state: Extract<WorkspaceManagementDialogState, { step: "workspace" }>,
  ) {
    const { project, workspaces, loading, error } = state;

    let body;
    if (loading) {
      body = html`
        <div class="loading-state" data-state="workspace-loading" role="status" aria-live="polite">
          Loading workspaces for ${project.name}…
        </div>
      `;
    } else if (error !== undefined) {
      body = html`
        <div class="error-state" data-state="workspace-error" role="alert">
          <p>Failed to load workspaces: ${error}</p>
          <button class="footer-btn" data-action="back" @click=${() => { this.onBack?.(); }}>← Back</button>
        </div>
      `;
    } else if (workspaces.length === 0) {
      body = html`
        <div class="empty-state" data-empty-workspaces>
          No workspaces found in ${project.name}.
        </div>
      `;
    } else {
      body = html`
        <div class="item-list" role="listbox" aria-label="Workspaces in ${project.name}">
          ${workspaces.map((ws) => html`
            <button
              class="item-btn"
              role="option"
              data-workspace-id=${ws.id}
              title=${ws.path}
              @click=${() => { this.onConfirmManage?.(ws); }}
            >
              <span class="item-primary">${ws.label}${ws.isMain ? " · main" : ""}</span>
              <span class="item-secondary">${ws.path}</span>
              <span class="item-action" aria-hidden="true">Manage →</span>
            </button>
          `)}
        </div>
      `;
    }

    return html`
      <div class="step" data-step="workspace">
        <p class="step-prompt">${project.name} · choose a workspace:</p>
        ${body}
        <footer class="dialog-footer">
          ${error === undefined
            ? html`
                <button class="footer-btn" data-action="back" @click=${() => { this.onBack?.(); }}>← Back</button>
              `
            : nothing}
          <button class="footer-btn" data-action="cancel" @click=${() => { this.onCancel?.(); }}>Cancel</button>
        </footer>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // Styles
  // -------------------------------------------------------------------------

  static override styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 10;
      color: var(--pi-text);
      font: 14px system-ui, sans-serif;
    }

    modal-surface {
      --modal-surface-width: min(560px, calc(100vw - 32px));
      --modal-surface-max-height: min(640px, calc(100vh - 32px));
    }

    /* ---- Header ---- */

    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--pi-border);
    }

    .dialog-header strong {
      font-size: clamp(0.9375rem, 0.92rem + 0.1cqi, 1rem);
      color: var(--pi-text-bright, #fff);
    }

    /* ---- Icon close button ---- */

    .icon-btn {
      display: grid;
      place-items: center;
      min-width: 44px;
      min-height: 44px;
      padding: 0;
      font-size: 20px;
      line-height: 1;
      color: var(--pi-muted, #aaa4bd);
      background: none;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }

    .icon-btn:hover {
      color: var(--pi-text-bright, #fff);
      background: var(--pi-surface-hover, #151b31);
    }

    /* ---- Steps ---- */

    .step {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    .step-prompt {
      margin: 0;
      padding: 12px 16px 8px;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      color: var(--pi-muted, #aaa4bd);
    }

    /* ---- Item list (projects / workspaces) ---- */

    .item-list {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .item-btn {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-rows: auto auto;
      align-items: center;
      gap: 2px 8px;
      width: 100%;
      min-height: 44px;
      padding: 10px 16px;
      text-align: left;
      font: inherit;
      color: var(--pi-text, #f7f4ff);
      background: none;
      border: none;
      border-bottom: 1px solid var(--pi-border-muted, #1b2340);
      cursor: pointer;
      transition: background 120ms ease;
    }

    .item-btn:hover {
      background: var(--pi-surface, #101527);
    }

    .item-btn:focus-visible {
      outline: 2px solid var(--pi-accent, #7c3cff);
      outline-offset: -2px;
    }

    .item-primary {
      grid-column: 1;
      grid-row: 1;
      font-size: clamp(0.9375rem, 0.92rem + 0.1cqi, 1rem);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-secondary {
      grid-column: 1;
      grid-row: 2;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      color: var(--pi-dim, #817a99);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-action {
      grid-column: 2;
      grid-row: 1 / span 2;
      align-self: center;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      color: var(--pi-accent, #7c3cff);
      white-space: nowrap;
      opacity: 0;
      transition: opacity 120ms ease;
    }

    .item-btn:hover .item-action,
    .item-btn:focus-visible .item-action {
      opacity: 1;
    }

    @media (hover: none) {
      .item-action { opacity: 1; }
    }

    /* ---- States ---- */

    .loading-state,
    .empty-state {
      padding: 24px 16px;
      color: var(--pi-dim, #817a99);
      font-size: clamp(0.9375rem, 0.92rem + 0.1cqi, 1rem);
    }

    .error-state {
      padding: 16px;
    }

    .error-state p {
      margin: 0 0 12px;
      color: var(--pi-danger, #ff4f7b);
    }

    /* ---- Footer ---- */

    .dialog-footer {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-top: 1px solid var(--pi-border, #26304f);
    }

    .footer-btn {
      display: grid;
      place-items: center;
      min-height: 44px;
      padding: 0 16px;
      font: inherit;
      font-size: clamp(0.9375rem, 0.92rem + 0.1cqi, 1rem);
      color: var(--pi-text, #f7f4ff);
      background: var(--pi-surface, #101527);
      border: 1px solid var(--pi-border, #26304f);
      border-radius: 8px;
      cursor: pointer;
    }

    .footer-btn:hover {
      background: var(--pi-surface-hover, #151b31);
    }

    .footer-btn:focus-visible {
      outline: 2px solid var(--pi-accent, #7c3cff);
      outline-offset: 2px;
    }
  `;
}
