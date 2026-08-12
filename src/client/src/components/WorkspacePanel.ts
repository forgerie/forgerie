import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { Workspace } from "../api";
import type { QualifiedContributionId, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { NEW_SESSION_LABEL, renderNewSessionIcon, workspacePanelStyles } from "./shared";

export interface WorkspacePanelEmptyState {
  title: string;
  body?: string;
}

type WorkspacePanelBadge = string | number | TemplateResult | undefined;

@customElement("workspace-panel")
export class WorkspacePanel extends LitElement {
  @property({ attribute: false }) workspace: Workspace | undefined;
  @property({ attribute: false }) panelContext: WorkspacePanelContext | undefined;
  @property({ attribute: false }) emptyState: WorkspacePanelEmptyState | undefined;
  @property() tool: QualifiedContributionId = "core:workspace.files";
  @property({ attribute: false }) panels: QualifiedWorkspacePanelContribution[] = [];
  @property({ type: Boolean }) hideToolTabs = false;
  /** The panel's own pin and close, rendered in this header beside its actions. */
  @property({ attribute: false }) panelControls?: unknown;
  @property({ attribute: false }) onSelectTool: (tool: QualifiedContributionId) => void = () => undefined;
  @property({ attribute: false }) onNewSession?: () => void;
  @query(".workspace-header-strip") private workspaceHeaderStrip?: HTMLElement | null;
  @state() private workspaceHeaderCanScrollLeft = false;
  @state() private workspaceHeaderCanScrollRight = false;

  private observedWorkspaceHeaderStrip: HTMLElement | undefined;
  private workspaceHeaderResizeObserver: ResizeObserver | undefined;
  private readonly onWorkspaceHeaderScroll = () => {
    this.updateWorkspaceHeaderScrollState();
  };

  override firstUpdated(): void {
    this.observeWorkspaceHeaderStrip();
    this.updateWorkspaceHeaderScrollState();
  }

  override updated(): void {
    this.observeWorkspaceHeaderStrip();
    this.updateWorkspaceHeaderScrollState();
  }

  override disconnectedCallback(): void {
    this.workspaceHeaderResizeObserver?.disconnect();
    this.workspaceHeaderResizeObserver = undefined;
    this.observedWorkspaceHeaderStrip = undefined;
    super.disconnectedCallback();
  }

  override render() {
    const workspace = this.workspace;
    if (workspace === undefined) return this.renderEmptyState(this.emptyState ?? {
      title: "Select a workspace",
      body: "Choose a workspace to inspect files, Git, or terminals.",
    });
    const context = this.panelContext;
    if (context === undefined) return this.renderEmptyState({
      title: "Workspace tools unavailable",
      body: "Try selecting the workspace again.",
    });
    const visiblePanels = this.panels;
    const selectedPanel = visiblePanels.find((panel) => panel.id === this.tool) ?? visiblePanels[0];
    return html`
      <header>
        ${this.hideToolTabs ? null : html`
          <div class=${this.workspaceHeaderFrameClass()}>
            <div class="workspace-header-strip" @scroll=${this.onWorkspaceHeaderScroll}>
              <div class="tabs">
                ${visiblePanels.map((panel) => {
                  const selected = selectedPanel?.id === panel.id;
                  const badge = panel.badge?.(context);
                  const ariaLabel = this.panelTabAriaLabel(panel, badge);
                  return html`
                    <button class=${this.panelTabClass(panel, selected)} title=${ariaLabel} aria-label=${ariaLabel} aria-pressed=${String(selected)} @click=${() => { this.onSelectTool(panel.id); }}>
                      ${this.renderPanelTabContent(panel, badge)}
                    </button>
                  `;
                })}
              </div>
            </div>
          </div>
        `}
        ${this.onNewSession === undefined ? null : html`
          <button
            class="workspace-header-action"
            data-action="new-session"
            title=${NEW_SESSION_LABEL}
            aria-label=${NEW_SESSION_LABEL}
            @click=${this.onNewSession}
          >${renderNewSessionIcon()}<span class="workspace-header-action-label">${NEW_SESSION_LABEL}</span></button>
        `}
        ${this.panelControls}
      </header>
      ${selectedPanel === undefined ? this.renderEmptyState({
        title: "No workspace tools available",
        body: "No tools are available for this workspace.",
      }) : html`
        <div class="panel-content">
          ${selectedPanel.render(context)}
        </div>
      `}
    `;
  }

  private panelTabClass(panel: QualifiedWorkspacePanelContribution, selected: boolean): string {
    return [
      ...(panel.icon === undefined ? [] : ["icon-tab"]),
      ...(selected ? ["selected"] : []),
    ].join(" ");
  }

  private panelTabAriaLabel(panel: QualifiedWorkspacePanelContribution, badge: WorkspacePanelBadge): string {
    if (typeof badge !== "string" && typeof badge !== "number") return panel.title;
    const trimmedBadge = String(badge).trim();
    return trimmedBadge === "" ? panel.title : `${panel.title}, ${trimmedBadge}`;
  }

  private renderPanelTabContent(panel: QualifiedWorkspacePanelContribution, badge: WorkspacePanelBadge): TemplateResult {
    return html`
      ${panel.icon === undefined ? null : html`<span class="tab-custom-icon" aria-hidden="true">${panel.icon}</span>`}
      <span class="tab-label">${panel.title}</span>
      ${this.isEmptyBadge(badge) ? null : html`<span class="tab-badge">${badge}</span>`}
    `;
  }

  private isEmptyBadge(badge: WorkspacePanelBadge): boolean {
    return badge === undefined || badge === "";
  }

  /**
   * An empty panel is still a panel, and still has to be closable.
   *
   * This path renders no tool strip, so without its own header row the panel's
   * pin and close would disappear exactly when there is nothing else to act on
   * -- a docked panel with no workspace selected and no way out of it.
   */
  private renderEmptyState(state: WorkspacePanelEmptyState): TemplateResult {
    return html`
      ${this.panelControls === undefined ? null : html`<header class="empty-state-header">${this.panelControls}</header>`}
      <section class="empty-state" role="status">
        <h2>${state.title}</h2>
        ${state.body === undefined ? null : html`<p>${state.body}</p>`}
      </section>
    `;
  }

  private workspaceHeaderFrameClass(): string {
    return `workspace-header-scroll-frame${this.workspaceHeaderCanScrollLeft ? " can-scroll-left" : ""}${this.workspaceHeaderCanScrollRight ? " can-scroll-right" : ""}`;
  }

  private observeWorkspaceHeaderStrip(): void {
    const strip = this.workspaceHeaderStripElement();
    if (this.observedWorkspaceHeaderStrip === strip) return;
    this.workspaceHeaderResizeObserver?.disconnect();
    this.observedWorkspaceHeaderStrip = strip;
    this.workspaceHeaderResizeObserver = undefined;
    if (strip === undefined || typeof ResizeObserver === "undefined") return;
    this.workspaceHeaderResizeObserver = new ResizeObserver(() => {
      this.updateWorkspaceHeaderScrollState();
    });
    this.workspaceHeaderResizeObserver.observe(strip);
  }

  private updateWorkspaceHeaderScrollState(): void {
    const strip = this.workspaceHeaderStripElement();
    const maxScrollLeft = strip === undefined ? 0 : Math.max(0, strip.scrollWidth - strip.clientWidth);
    const canScrollLeft = strip !== undefined && strip.scrollLeft > 1;
    const canScrollRight = strip !== undefined && maxScrollLeft - strip.scrollLeft > 1;
    if (this.workspaceHeaderCanScrollLeft !== canScrollLeft) this.workspaceHeaderCanScrollLeft = canScrollLeft;
    if (this.workspaceHeaderCanScrollRight !== canScrollRight) this.workspaceHeaderCanScrollRight = canScrollRight;
  }

  private workspaceHeaderStripElement(): HTMLElement | undefined {
    const strip = this.workspaceHeaderStrip;
    return strip instanceof HTMLElement ? strip : undefined;
  }

  static override styles = workspacePanelStyles;
}
