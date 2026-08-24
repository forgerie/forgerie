import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

export const SETTINGS_NOTICE_TONES = ["error", "success", "warning", "info"] as const;
export type SettingsNoticeTone = (typeof SETTINGS_NOTICE_TONES)[number];

export const SETTINGS_NOTICE_TYPES = ["availability", "error", "success", "security", "warning", "info"] as const;
export type SettingsNoticeType = (typeof SETTINGS_NOTICE_TYPES)[number];

export type SettingsNoticeRole = "alert" | "note" | "status";
export type SettingsNoticeContent = string | TemplateResult;

export interface SettingsNotice {
  readonly type: SettingsNoticeType;
  readonly content: SettingsNoticeContent;
  readonly tone?: SettingsNoticeTone;
  readonly title?: string;
  readonly role?: SettingsNoticeRole;
}

const DEFAULT_NOTICE_TONE: Record<SettingsNoticeType, SettingsNoticeTone> = {
  availability: "error",
  error: "error",
  success: "success",
  security: "warning",
  warning: "warning",
  info: "info",
};

export function settingsNoticeTone(notice: SettingsNotice): SettingsNoticeTone {
  return notice.tone ?? DEFAULT_NOTICE_TONE[notice.type];
}

@customElement("settings-panel-frame")
export class SettingsPanelFrame extends LitElement {
  @property() heading = "";
  @property({ attribute: false }) description: SettingsNoticeContent = "";
  @property() actionLabel = "";
  @property() actionTitle = "";
  @property({ type: Boolean }) actionDisabled = false;
  @property({ attribute: false }) notices: readonly SettingsNotice[] = [];
  @property({ attribute: false }) onAction?: () => void | Promise<void>;

  /**
   * The panel has no visible title. Every panel's heading restated its own tab
   * label -- General/General, Keyboard/Keyboard shortcuts -- so the tab is the
   * title and `heading` survives only as the region's accessible name. The
   * reload action shares the description line instead of claiming a band.
   */
  override render(): TemplateResult {
    return html`
      <section class="panel" aria-label=${this.heading || "Settings panel"}>
        ${this.renderSectionHeading()}
        ${this.renderNoticeStack()}
        <div class="content"><slot></slot></div>
      </section>
    `;
  }

  private renderSectionHeading(): TemplateResult | typeof nothing {
    const action = this.renderDefaultAction();
    if (this.description === "" && action === nothing) return nothing;
    return html`
      <header class="section-heading">
        <div class="description"><slot name="description">${this.description}</slot></div>
        <div class="heading-actions"><slot name="actions">${action}</slot></div>
      </header>
    `;
  }

  private renderDefaultAction(): TemplateResult | typeof nothing {
    if (this.actionLabel === "") return nothing;
    return html`
      <button
        class="secondary"
        title=${this.actionTitle || this.actionLabel}
        ?disabled=${this.actionDisabled}
        @click=${() => { void this.onAction?.(); }}
      >${this.actionLabel}</button>
    `;
  }

  private renderNoticeStack(): TemplateResult | typeof nothing {
    if (this.notices.length === 0) return nothing;
    return html`
      <div class="notice-stack" aria-label="Settings notices">
        ${this.notices.map((notice) => this.renderNotice(notice))}
      </div>
    `;
  }

  private renderNotice(notice: SettingsNotice): TemplateResult {
    const tone = settingsNoticeTone(notice);
    const role = notice.role ?? defaultNoticeRole(tone);
    const title = notice.title;
    return html`
      <article class=${`notice ${tone}`} role=${role}>
        ${title === undefined || title === "" ? nothing : html`<strong class="notice-title">${title}</strong>`}
        <div class="notice-content">${notice.content}</div>
      </article>
    `;
  }

  static override styles = css`
    :host { display: block; container-type: inline-size; }
    .panel { display: block; }
    .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .heading-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
    .description { flex: 1 1 auto; min-width: 0; color: var(--pi-muted); font-size: var(--pi-text-sm); line-height: 1.45; }
    .description ::slotted(*) { margin: 0; }
    /* 4px everywhere. Mixed radii on one screen are what read as bubbly. */
    button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-inline); background: var(--pi-surface); color: var(--pi-text); padding: 6px 10px; font: inherit; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .secondary { flex: 0 0 auto; }
    .notice-stack { display: grid; gap: 12px; margin-bottom: 14px; }
    .notice { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-inline); background: var(--pi-surface); padding: var(--pi-space-md); line-height: 1.45; }
    .notice.error { border-color: var(--pi-danger); color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-surface)); }
    .notice.success { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-surface); }
    .notice.warning { border-color: var(--pi-warning-border); color: var(--pi-text); background: var(--pi-warning-surface); }
    .notice.info { color: var(--pi-muted); }
    .notice-title { display: block; margin-bottom: 4px; color: inherit; }
    .notice-content { min-width: 0; }
    code { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-inline); background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: var(--pi-text-sm) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .content { display: grid; gap: 14px; min-width: 0; }
    .content ::slotted(*) { min-width: 0; }

    /*
     * No width query. The settings content column measures 451-680px across the
     * Fold 8 posture matrix, so a rule that stacked the action below the
     * description would fire at every posture and cost a band everywhere.
     */
  `;
}

function defaultNoticeRole(tone: SettingsNoticeTone): SettingsNoticeRole {
  switch (tone) {
    case "error": return "alert";
    case "success": return "status";
    case "warning":
    case "info": return "note";
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-panel-frame": SettingsPanelFrame;
  }
}
