import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { AppState } from "../../appState";

export interface AppSessionTab {
  id: AppState["mainView"];
  label: string;
  /** Chat is permanent: it renders without a close control even while active. */
  closeable: boolean;
}

/**
 * The session tab band: chat plus the tools this session promoted.
 *
 * Obsidian grammar. Inactive tabs are quiet text with hairline separators;
 * the active tab is a card in the page's own background, fused with the
 * surface below it, and carries the only close control. The band exists only
 * while a session has promoted tabs, so a bare conversation pays no chrome.
 */
@customElement("app-session-tabs")
export class AppSessionTabs extends LitElement {
  @property({ attribute: false }) tabs: AppSessionTab[] = [];
  @property({ attribute: false }) selected: AppState["mainView"] = "chat";
  @property({ attribute: false }) onSelect?: (id: AppState["mainView"]) => void;
  @property({ attribute: false }) onClose?: (id: AppState["mainView"]) => void;

  override render() {
    return html`
      <div class="tabs" role="tablist" aria-label="Session tabs">
        ${this.tabs.map((tab) => this.renderTab(tab))}
      </div>
    `;
  }

  private renderTab(tab: AppSessionTab) {
    const selected = this.selected === tab.id;
    return html`
      <div
        class=${`tab${selected ? " active" : ""}`}
        role="tab"
        tabindex="0"
        aria-selected=${String(selected)}
        @click=${() => { this.onSelect?.(tab.id); }}
        @keydown=${(event: KeyboardEvent) => { this.onTabKeydown(event, tab); }}
      >
        <span class="label" title=${tab.label}>${tab.label}</span>
        ${selected && tab.closeable ? html`
          <button
            type="button"
            class="close"
            title=${`Close ${tab.label} tab`}
            aria-label=${`Close ${tab.label} tab`}
            @click=${(event: Event) => { event.stopPropagation(); this.onClose?.(tab.id); }}
          >
            <svg class="close-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12" /><path d="M18 6L6 18" />
            </svg>
          </button>
        ` : null}
      </div>
    `;
  }

  private onTabKeydown(event: KeyboardEvent, tab: AppSessionTab): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.onSelect?.(tab.id);
  }

  static override styles = css`
    :host { display: block; flex: 0 0 auto; min-width: 0; background: var(--tab-band); }
    .tabs {
      display: flex;
      align-items: flex-end;
      min-width: 0;
      padding: 6px 8px 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tab {
      position: relative;
      flex: 0 1 auto;
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 16px;
      color: var(--pi-muted);
      font-size: var(--pi-text-md, 14px);
      white-space: nowrap;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .tab:focus-visible { outline: var(--pi-focus-ring); outline-offset: -2px; border-radius: var(--pi-radius-control); }
    .label { overflow: hidden; text-overflow: ellipsis; max-width: 22ch; }
    /*
     * Hairline separators between inactive neighbours only: never beside the
     * active card, never before the first tab. The separator belongs to the
     * right tab of each pair, so hiding it when either neighbour is active
     * takes one selector each way.
     */
    .tab + .tab::before {
      content: "";
      position: absolute;
      left: 0;
      top: 50%;
      translate: 0 -50%;
      width: 1px;
      height: 16px;
      background: var(--pi-border);
    }
    .tab.active::before, .tab.active + .tab::before { display: none; }
    .tab:hover { color: var(--pi-text-secondary); }
    /* The active tab is the page itself: same background, fused at the seam. */
    .tab.active {
      background: var(--pi-bg);
      color: var(--pi-text);
      border-radius: var(--pi-radius-control) var(--pi-radius-control) 0 0;
    }
    .tab.active .label { padding-right: 0; }
    .close {
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      width: 20px;
      height: 20px;
      margin-right: -6px;
      padding: 0;
      border: 0;
      border-radius: var(--pi-radius-inline);
      background: transparent;
      color: var(--pi-muted);
      cursor: pointer;
    }
    .close:hover, .close:focus-visible { background: var(--pi-surface-hover); color: var(--pi-text); }
    .close-icon { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "app-session-tabs": AppSessionTabs;
  }
}
