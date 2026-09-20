import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PiWebConfigResponse, PiWebPluginInfo, PiWebPluginSettings, PiWebPluginsResponse } from "../../api";
import type { PluginSettingsField } from "../../plugins/types";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { pluginSettingsBoolean } from "./settingsPluginConfig";

@customElement("settings-plugins-panel")
export class SettingsPluginsPanel extends LitElement {
  @property({ attribute: false }) pluginsResponse: PiWebPluginsResponse | undefined;
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property() targetLabel = "local (local gateway)";
  @property({ attribute: false }) settingsFieldsForPlugin?: (pluginId: string) => readonly PluginSettingsField[];
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onTogglePlugin?: (pluginId: string, enabled: boolean) => void | Promise<void>;
  @property({ attribute: false }) onSavePluginSetting?: (pluginId: string, fieldId: string, value: boolean) => void | Promise<void>;

  override render(): TemplateResult {
    const plugins = this.pluginsResponse?.plugins ?? [];
    const hasPluginResponse = this.pluginsResponse !== undefined;
    return html`
      <settings-panel-frame
        heading="Forgerie plugins"
        .description=${pluginsDescription(this.targetLabel)}
        actionLabel="Reload"
        actionTitle=${`Reload Forgerie plugins from ${this.targetLabel}`}
        .actionDisabled=${this.loading}
        .notices=${this.panelNotices(plugins.length > 0)}
        .onAction=${this.onReload}
      >
        ${this.renderPanelContent(plugins, hasPluginResponse)}
      </settings-panel-frame>
    `;
  }

  private panelNotices(showTrustedCodeWarning: boolean): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    if (this.error !== "") notices.push({ type: "error", content: this.error });
    if (this.shouldShowConfigUnavailableNotice(showTrustedCodeWarning)) {
      notices.push({ type: "availability", content: "Configuration unavailable. Reload before toggling plugins." });
    }
    if (this.savedMessage !== "") notices.push({ type: "success", content: this.savedMessage });
    if (showTrustedCodeWarning) {
      notices.push({
        type: "security",
        content: html`Plugins and packages run with your user permissions. Enable only plugins you trust.`,
      });
    }
    return notices;
  }

  private shouldShowConfigUnavailableNotice(hasLoadedPlugins: boolean): boolean {
    return hasLoadedPlugins && this.configResponse === undefined && !this.loading && this.error === "";
  }

  private renderPanelContent(plugins: PiWebPluginInfo[], hasPluginResponse: boolean): TemplateResult {
    if (!hasPluginResponse) {
      return html`<div class="loading-card">${this.loading ? "Loading plugins…" : "Plugin list unavailable. Reload to try again."}</div>`;
    }
    if (plugins.length === 0) {
      return html`<div class="loading-card">No plugins found on ${this.targetLabel}.</div>`;
    }
    return html`
      <div class="plugin-note">Saved under <code>plugins</code>. Enabled unless set to <code>false</code>.</div>
      <div class="plugin-list">
        ${plugins.map((plugin) => this.renderPlugin(plugin))}
      </div>
    `;
  }

  private renderPlugin(plugin: PiWebPluginInfo): TemplateResult {
    const configured = this.configResponse?.config.plugins?.[plugin.id];
    const configuredState = configured?.enabled === false ? "Config disabled" : configured?.enabled === true ? "Config enabled" : "Default enabled";
    const fields = this.settingsFieldsForPlugin?.(plugin.id) ?? [];
    return html`
      <article class=${`plugin-card${plugin.enabled ? "" : " disabled"}`}>
        <div class="plugin-main">
          <strong>${plugin.id}</strong>
          <small>${plugin.source} · ${plugin.scope}${plugin.machineSpecific ? " · machine-specific" : ""}</small>
          <small>${configuredState}</small>
        </div>
        <label class="toggle">
          <input type="checkbox" .checked=${plugin.enabled} ?disabled=${this.saving || this.configResponse === undefined} @change=${(event: Event) => { void this.togglePlugin(plugin, event); }}>
          <span>${plugin.enabled ? "Enabled" : "Disabled"}</span>
        </label>
        ${fields.length === 0 ? nothing : this.renderPluginSettings(plugin, fields, configured?.settings)}
      </article>
    `;
  }

  private renderPluginSettings(plugin: PiWebPluginInfo, fields: readonly PluginSettingsField[], settings: PiWebPluginSettings | undefined): TemplateResult {
    return html`
      <fieldset class="plugin-settings">
        <legend>Settings</legend>
        ${fields.map((field) => this.renderPluginSetting(plugin, field, settings))}
      </fieldset>
    `;
  }

  private renderPluginSetting(plugin: PiWebPluginInfo, field: PluginSettingsField, settings: PiWebPluginSettings | undefined): TemplateResult {
    const disabled = this.saving || this.configResponse === undefined;
    return html`
      <label class="plugin-setting">
        <span class="plugin-setting-text">
          <strong>${field.label}</strong>
          ${field.description === undefined ? nothing : html`<small>${field.description}</small>`}
        </span>
        <input
          type="checkbox"
          .checked=${pluginSettingsBoolean(settings, field.id, field.default)}
          ?disabled=${disabled}
          @change=${(event: Event) => { void this.savePluginSetting(plugin, field, event); }}
        >
      </label>
    `;
  }

  private async savePluginSetting(plugin: PiWebPluginInfo, field: PluginSettingsField, event: Event): Promise<void> {
    const value = event.target instanceof HTMLInputElement ? event.target.checked : pluginSettingsBoolean(undefined, field.id, field.default);
    await this.onSavePluginSetting?.(plugin.id, field.id, value);
  }

  private async togglePlugin(plugin: PiWebPluginInfo, event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement ? event.target.checked : plugin.enabled;
    await this.onTogglePlugin?.(plugin.id, enabled);
  }

  static override styles = css`
    :host { display: block; container-type: inline-size; }
    input { font: inherit; }
    input:disabled { opacity: .55; cursor: not-allowed; }
    .loading-card, .plugin-note, .plugin-card { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-surface); background: var(--pi-surface); padding: var(--pi-space-md); }
    .loading-card, .plugin-note { color: var(--pi-muted); }
    code { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-inline); background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: var(--pi-text-sm) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .plugin-list { display: grid; gap: 10px; }
    .plugin-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
    .plugin-card.disabled { opacity: .75; }
    .plugin-main { min-width: 0; display: grid; gap: 3px; }
    .plugin-main strong, .plugin-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .plugin-main small { color: var(--pi-muted); }
    .toggle { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
    .toggle input { width: 18px; height: 18px; accent-color: var(--pi-accent); }

    .plugin-settings { grid-column: 1 / -1; min-width: 0; margin: 4px 0 0; padding: 10px 0 0; border: 0; border-top: 1px solid var(--pi-border-muted); }
    .plugin-settings legend { padding: 0; color: var(--pi-muted); font-size: var(--pi-text-sm); text-transform: uppercase; letter-spacing: .06em; }
    .plugin-setting { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; column-gap: 10px; padding: 8px 0; cursor: pointer; }
    .plugin-setting + .plugin-setting { border-top: 1px solid color-mix(in oklab, var(--pi-border-muted) 55%, transparent); }
    .plugin-setting-text { display: grid; gap: 2px; min-width: 0; }
    .plugin-setting-text strong { font-weight: 500; }
    .plugin-setting-text small { color: var(--pi-muted); }
    .plugin-setting input { width: 18px; height: 18px; margin: 1px 0 0; accent-color: var(--pi-accent); }
    .plugin-setting input:disabled { opacity: .55; cursor: not-allowed; }
    .plugin-setting:has(input:disabled) { cursor: not-allowed; opacity: .75; }

    @container (max-width: 760px) {
      .plugin-card { grid-template-columns: minmax(0, 1fr); align-items: start; }
      .toggle { justify-self: start; }
    }

    @container (max-width: 420px) {
      .plugin-setting { grid-template-columns: minmax(0, 1fr); row-gap: 8px; }
      .plugin-setting input { justify-self: start; }
    }
  `;
}

function pluginsDescription(targetLabel: string): TemplateResult {
  return html`Browser plugins on <strong>${targetLabel}</strong>. Plugins come from Pi packages.`;
}
