import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

export interface ComposerChoiceItem {
  readonly value: string;
  readonly label: string;
  /** Set beside the label when two rows would otherwise read alike. */
  readonly variant?: string;
  /** A second line, for a description the choice cannot be read without. */
  readonly detail?: string;
  /** A right-aligned figure: a context window, or why a row is unavailable. */
  readonly meta?: string;
  /** Drawn quietly, but still choosable — a capability the row lacks. */
  readonly muted?: boolean;
  readonly disabled?: boolean;
}

export interface ComposerChoiceGroup {
  /** Omitted when the choices do not divide into named groups. */
  readonly label?: string;
  /**
   * A section names a set the reader must tell apart; a provider only sorts
   * rows inside one. They differ by weight, never by colour, so a section
   * heading is never mistaken for a selected row.
   */
  readonly level?: "section" | "provider";
  /** How many rows the set holds, stated beside a section heading. */
  readonly count?: number;
  /** Rules this group off from the one above it. */
  readonly divider?: boolean;
  readonly items: readonly ComposerChoiceItem[];
}

/**
 * The list inside a composer popover.
 *
 * One mechanism for every choice, sized by its content: a heading appears only
 * for a named group, and a search field only when the host asks for one. A
 * seven-row scale never grows the chrome that a thirty-row catalogue needs.
 */
@customElement("composer-choice-list")
export class ComposerChoiceList extends LitElement {
  @property({ attribute: false }) groups: readonly ComposerChoiceGroup[] = [];
  @property() selectedValue?: string;
  @property({ type: Boolean }) searchable = false;
  @property() error?: string;
  /** True while the choices are being read; an empty list means nothing yet. */
  @property({ type: Boolean }) loading = false;
  /** Said when there is nothing to choose and nothing was searched for. */
  @property() emptyMessage = "Nothing to choose from";
  @property() searchLabel = "Search";
  @property({ attribute: false }) onPick?: (value: string) => void;
  @property({ attribute: false }) onRetry?: () => void;

  @state() private query = "";

  override render(): TemplateResult {
    const groups = this.filteredGroups();
    const empty = groups.every((group) => group.items.length === 0);
    return html`
      ${this.error === undefined ? nothing : html`
        <div class="choice-error" role="alert">
          <p>${this.error}</p>
          ${this.onRetry === undefined ? nothing : html`<button type="button" data-action="retry" @click=${() => { this.onRetry?.(); }}>Retry</button>`}
        </div>
      `}
      ${!this.searchable ? nothing : html`
        <div class="choice-search">
          <input
            type="search"
            aria-label=${this.searchLabel}
            placeholder=${this.searchLabel}
            .value=${this.query}
            @input=${(event: Event) => { this.handleSearch(event); }}
          />
        </div>
      `}
      <div class="choice-options" role="listbox">
        ${groups.map((group) => html`
          ${empty ? nothing : this.renderHeading(group)}
          ${group.items.map((item) => this.renderItem(item))}
        `)}
        ${this.renderEmptyState(empty)}
      </div>
    `;
  }

  /**
   * An empty list has three quite different meanings, and saying the wrong one
   * reads as a broken panel: still reading, searched for something absent, or
   * genuinely nothing to offer.
   */
  private renderEmptyState(empty: boolean) {
    if (this.error !== undefined) return nothing;
    if (this.loading) return html`<p class="choice-empty" role="status">Reading the catalogue…</p>`;
    if (!empty) return nothing;
    const query = this.query.trim();
    return query === ""
      ? html`<p class="choice-empty">${this.emptyMessage}</p>`
      : html`<p class="choice-empty">Nothing matches ${query}</p>`;
  }

  /**
   * A section heading survives an empty group, because it names the set the
   * groups below it belong to. A provider heading does not: with its rows
   * filtered away it names nothing.
   */
  private renderHeading(group: ComposerChoiceGroup) {
    if (group.label === undefined) return nothing;
    const section = group.level === "section";
    if (group.items.length === 0 && !section) return nothing;
    // A count describes the whole set, so a search that hides rows drops it.
    const count = group.count !== undefined && this.query.trim() === ""
      ? html`<span class="choice-count">${group.count}</span>`
      : nothing;
    return html`<p class="choice-group ${section ? "section" : "provider"}" ?data-divider=${group.divider === true}><span class="choice-group-label">${group.label}</span>${count}</p>`;
  }

  private renderItem(item: ComposerChoiceItem): TemplateResult {
    const selected = item.value === this.selectedValue;
    return html`
      <button
        type="button"
        role="option"
        data-value=${item.value}
        ?data-muted=${item.muted === true}
        ?disabled=${item.disabled === true}
        aria-checked=${selected ? "true" : "false"}
        aria-selected=${selected ? "true" : "false"}
        @click=${() => { this.pick(item); }}
      >
        <span class="choice-copy">
          <span class="choice-label">${item.label}${item.variant === undefined ? nothing : html`<span class="choice-variant"> · ${item.variant}</span>`}</span>
          ${item.detail === undefined ? nothing : html`<small>${item.detail}</small>`}
        </span>
        ${item.meta === undefined ? nothing : html`<span class="choice-meta">${item.meta}</span>`}
      </button>
    `;
  }

  private pick(item: ComposerChoiceItem): void {
    if (item.disabled === true) return;
    this.onPick?.(item.value);
  }

  private handleSearch(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.query = event.target.value;
  }

  private filteredGroups(): readonly ComposerChoiceGroup[] {
    const query = this.query.trim().toLowerCase();
    if (query === "") return this.groups;
    return this.groups.map((group) => ({
      ...group,
      items: group.items.filter((item) => `${item.label} ${item.variant ?? ""} ${item.detail ?? ""} ${item.value} ${group.label ?? ""}`.toLowerCase().includes(query)),
    }));
  }

  static override styles = css`
    :host { display: block; color: var(--pi-text); font: 13px system-ui, sans-serif; }
    .choice-search { padding: 8px 10px 4px; }
    .choice-search input { box-sizing: border-box; width: 100%; padding: 6px 8px; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); font: inherit; }
    /*
     * One label style, two ranks. A section and a provider differ by weight
     * alone: colour is spoken for, since a tinted row already means "selected"
     * and a filled band would read as a stuck hover state.
     */
    .choice-group { display: flex; align-items: baseline; gap: 8px; margin: 0; padding: 6px 11px 4px; color: var(--pi-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
    .choice-group.section { font-weight: 700; }
    .choice-group.provider { font-weight: 500; }
    .choice-group[data-divider] { margin-top: 2px; border-top: 1px solid var(--pi-border); padding-top: 8px; }
    .choice-count { margin-left: auto; font-weight: 500; letter-spacing: 0; font-variant-numeric: tabular-nums; }
    .choice-variant { color: var(--pi-muted); }
    .choice-options button {
      box-sizing: border-box; width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center;
      padding: 8px 11px; border: 0; border-radius: 0; background: transparent; color: var(--pi-text); font: inherit; text-align: left; cursor: pointer;
    }
    .choice-options button + button { border-top: 1px solid var(--pi-border-muted); }
    .choice-options button:hover:not(:disabled), .choice-options button:focus-visible { background: var(--pi-selection-bg); }
    .choice-options button:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    .choice-options button[aria-checked="true"] { background: var(--pi-selection-bg); }
    .choice-options button[data-muted] .choice-label { color: var(--pi-muted); }
    .choice-options button:disabled { cursor: default; }
    .choice-options button:disabled .choice-label { color: var(--pi-muted); }
    .choice-copy { min-width: 0; display: grid; gap: 2px; }
    .choice-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .choice-copy small { color: var(--pi-muted); line-height: 1.35; white-space: normal; }
    .choice-meta { color: var(--pi-muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
    .choice-empty, .choice-error { margin: 0; padding: 10px 11px; color: var(--pi-muted); font-size: 12px; }
    .choice-error { display: grid; gap: 8px; color: var(--pi-danger); }
    .choice-error button { justify-self: start; padding: 4px 10px; border: 1px solid var(--pi-border); border-radius: 6px; background: transparent; color: var(--pi-text); font: inherit; cursor: pointer; }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "composer-choice-list": ComposerChoiceList;
  }
}
