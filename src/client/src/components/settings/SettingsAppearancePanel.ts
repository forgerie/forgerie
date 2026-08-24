import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { DEFAULT_INBOX_DENSITY, type InboxDensity } from "../../inboxDensity";
import "./SettingsPanelFrame";

interface InboxDensityChoice {
  readonly value: InboxDensity;
  readonly label: string;
  readonly description: string;
}

/**
 * Both choices, in the order they are offered. The panel reads this list rather
 * than restating the cases, so a third density cannot be added to the model
 * without appearing here.
 */
export const INBOX_DENSITY_CHOICES: readonly InboxDensityChoice[] = [
  {
    value: "dense",
    label: "Dense",
    description: "One line per session. A session waiting on you, or reporting an error, still takes a second line for its message.",
  },
  {
    value: "comfortable",
    label: "Comfortable",
    description: "Two lines per session. The location always takes a line of its own, whether or not there is anything beside it.",
  },
];

/**
 * Display choices that belong to this browser rather than to a machine.
 *
 * Nothing here is saved to a config file: these are per-browser preferences, so
 * the panel has no reload action and no save button. A choice applies as it is
 * made and is remembered in local storage.
 */
@customElement("settings-appearance-panel")
export class SettingsAppearancePanel extends LitElement {
  @property({ attribute: false }) inboxDensity: InboxDensity = DEFAULT_INBOX_DENSITY;
  @property({ attribute: false }) onInboxDensityChange?: (density: InboxDensity) => void;

  override render(): TemplateResult {
    return html`
      <settings-panel-frame
        heading="Appearance"
        .description=${"Saved in this browser. Other browsers and other machines keep their own choices."}
      >
        <section class="settings-card" aria-label="Session inbox density">
          <div class="card-heading">
            <h3>Session inbox density</h3>
            <p>How much vertical space one session takes in the inbox.</p>
          </div>
          <div class="choices" role="radiogroup" aria-label="Session inbox density">
            ${INBOX_DENSITY_CHOICES.map((choice) => this.renderChoice(choice))}
          </div>
        </section>
      </settings-panel-frame>
    `;
  }

  private renderChoice(choice: InboxDensityChoice): TemplateResult {
    const selected = this.inboxDensity === choice.value;
    return html`
      <button
        class=${selected ? "choice selected" : "choice"}
        role="radio"
        aria-checked=${selected ? "true" : "false"}
        data-density=${choice.value}
        @click=${() => { this.onInboxDensityChange?.(choice.value); }}
      >
        <span class="choice-label">${choice.label}</span>
        <span class="choice-description">${choice.description}</span>
      </button>
    `;
  }

  static override styles = css`
    :host { display: block; container-type: inline-size; }
    h3, p { margin: 0; }
    h3 { font-size: var(--pi-text-sm); line-height: 1.3; }
    p { color: var(--pi-muted); line-height: 1.45; }
    .card-heading { display: grid; gap: 6px; min-width: 0; }
    .settings-card {
      display: grid;
      gap: 14px;
      border: 1px solid var(--pi-border-muted);
      border-radius: var(--pi-radius-surface);
      background: var(--pi-surface);
      padding: var(--pi-space-md);
    }
    /*
     * Tracks are added when the column has room for them, rather than switched
     * at a width. Two choices sit side by side on a wide settings column and
     * stack on a narrow one without a rule that names either width.
     */
    .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .choice {
      display: grid;
      gap: 5px;
      min-width: 0;
      text-align: left;
      font: inherit;
      color: var(--pi-text);
      background: var(--pi-bg);
      border: 1px solid var(--pi-border);
      border-radius: var(--pi-radius-control);
      padding: 10px;
      cursor: pointer;
    }
    .choice:hover { background: var(--pi-surface-hover); }
    .choice:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px; }
    .choice.selected { border-color: var(--pi-accent-border, var(--pi-accent)); box-shadow: inset 2px 0 0 var(--pi-accent); }
    .choice-label { font-weight: 650; }
    .choice-description { color: var(--pi-muted); font-size: var(--pi-text-sm); line-height: 1.45; }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-appearance-panel": SettingsAppearancePanel;
  }
}
