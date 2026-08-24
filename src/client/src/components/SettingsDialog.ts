import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppAction } from "../actions";
import { configApi, piPackagesApi, pluginsApi, type Machine, type MachineRuntime, type PiPackageMutationResponse, type PiPackageScope, type PiPackagesResponse, type PiWebConfigResponse, type PiWebConfigValues, type PiWebPluginsResponse } from "../api";
import type { SettingsSection } from "../settingsRoute";
import "./ModalSurface";
import "./settings/SettingsGeneralPanel";
import "./settings/SettingsSessiondPanel";
import "./settings/SettingsPackagesPanel";
import "./settings/SettingsPluginsPanel";
import "./settings/SettingsShortcutsPanel";
import { friendlyPiPackageErrorMessage, piPackageMutationFollowUpMessage, piPackageTargetLabel, shouldRefreshGatewayPluginsAfterPiPackageMutation, type PiPackageOperationState, type PiPackageTargetContext } from "./settings/piPackageSettings";
import { loadGatewaySettingsData, loadPiPackagesData } from "./settings/settingsDataLoading";
import { mergeSelectedMachineAccessConfig } from "./settings/settingsMachineAccessConfig";
import { friendlySelectedMachineSettingsErrorMessage, settingsMachineTarget, settingsMachineTargetLabel, type SettingsMachineTarget } from "./settings/settingsMachineTarget";
import { mergeSelectedMachinePluginConfig, pluginEnabledConfigPatch } from "./settings/settingsPluginConfig";
import { mergeSelectedMachineSessiondConfig } from "./settings/settingsSessiondConfig";

@customElement("settings-dialog")
export class SettingsDialog extends LitElement {
  @property({ attribute: false }) section: SettingsSection = "general";
  @property({ attribute: false }) actions: AppAction[] = [];
  @property({ attribute: false }) machine: Machine | undefined;
  @property({ attribute: false }) machineRuntime: MachineRuntime | undefined;
  @property({ attribute: false }) onNavigate?: (section: SettingsSection) => void;
  @property({ attribute: false }) onClose?: () => void;
  @property({ attribute: false }) onConfigSaved?: (config: PiWebConfigValues) => void;
  @property({ attribute: false }) onRefreshMachineRuntime?: (machineId: string) => void | Promise<void>;
  @state() private configResponse: PiWebConfigResponse | undefined;
  @state() private accessConfigResponse: PiWebConfigResponse | undefined;
  @state() private sessiondConfigResponse: PiWebConfigResponse | undefined;
  @state() private pluginsResponse: PiWebPluginsResponse | undefined;
  @state() private selectedPluginConfigResponse: PiWebConfigResponse | undefined;
  @state() private selectedPluginsResponse: PiWebPluginsResponse | undefined;
  @state() private packagesResponse: PiPackagesResponse | undefined;
  @state() private loading = true;
  @state() private accessLoading = true;
  @state() private sessiondLoading = true;
  @state() private pluginLoading = true;
  @state() private packageLoading = true;
  @state() private saving = false;
  @state() private packageOperation: PiPackageOperationState | undefined;
  @state() private error = "";
  @state() private accessError = "";
  @state() private sessiondError = "";
  @state() private pluginError = "";
  @state() private packageError = "";
  @state() private savedMessage = "";
  @state() private packageMessage = "";
  private savedMessageTimer: number | undefined;
  private loadRequestSeq = 0;
  private accessLoadRequestSeq = 0;
  private sessiondLoadRequestSeq = 0;
  private pluginLoadRequestSeq = 0;
  private packageLoadRequestSeq = 0;
  private packageMutationSeq = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadConfig();
    void this.loadAccessConfigForTarget();
    void this.reloadSessiondState();
    void this.loadPluginsForTarget();
    void this.loadPackagesForTarget();
  }

  override disconnectedCallback(): void {
    if (this.savedMessageTimer !== undefined) window.clearTimeout(this.savedMessageTimer);
    this.savedMessageTimer = undefined;
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("section")) this.revealSelectedNavButton();
    const currentTarget = this.settingsTarget();
    if (!changed.has("machine")) return;
    const previousTarget = settingsMachineTarget(changed.get("machine"));
    if (previousTarget.id === currentTarget.id) return;
    this.resetAccessStateForTargetChange();
    if (this.isConnected) void this.loadAccessConfigForTarget(currentTarget);
    this.resetSessiondStateForTargetChange();
    if (this.isConnected) void this.loadSessiondConfigForTarget(currentTarget);
    this.resetPluginStateForTargetChange();
    if (this.isConnected) void this.loadPluginsForTarget(currentTarget);
    this.resetPackageStateForTargetChange();
    if (this.isConnected) void this.loadPackagesForTarget(currentTarget);
  }

  override render(): TemplateResult {
    return html`
      <modal-surface .onClose=${() => this.onClose?.()} .label=${"Forgerie settings"}>
        <div class="settings-body">
          <div class="settings-chrome">
            <button class="close-button" title="Close settings" aria-label="Close settings" @click=${() => this.onClose?.()}>×</button>
            <nav class="settings-nav" aria-label="Settings sections">
              ${this.renderNavButton("general", "General")}
              ${this.renderNavButton("sessiond", "Session daemon")}
              ${this.renderNavButton("packages", "Pi packages")}
              ${this.renderNavButton("plugins", "Forgerie plugins")}
              ${this.renderNavButton("shortcuts", "Keyboard")}
            </nav>
          </div>
          <main class="settings-content">
            ${this.renderActiveSection()}
          </main>
        </div>
      </modal-surface>
    `;
  }

  private renderActiveSection(): TemplateResult {
    // Keep the section -> panel routing in sync with the public
    // `activeSettingsPanelTag` seam below, which tests assert against instead of
    // scraping this template's markup.
    if (this.section === "sessiond") {
      return html`
        <settings-sessiond-panel
          .configResponse=${this.sessiondConfigResponse}
          .loading=${this.sessiondLoading}
          .saving=${this.saving}
          .error=${this.sessiondError}
          .savedMessage=${this.savedMessage}
          .targetLabel=${settingsMachineTargetLabel(this.settingsTarget())}
          .activeAgentProfile=${this.machineRuntime?.components?.sessiond.activeAgentProfile}
          .onReload=${() => this.reloadSessiondState()}
          .onSave=${(config: PiWebConfigValues) => this.saveSessiondConfig(config)}
        ></settings-sessiond-panel>
      `;
    }
    if (this.section === "shortcuts") {
      return html`
        <settings-shortcuts-panel
          .actions=${this.actions}
          .configResponse=${this.configResponse}
          .loading=${this.loading}
          .saving=${this.saving}
          .error=${this.error}
          .savedMessage=${this.savedMessage}
          .onReload=${() => this.loadConfig()}
          .onSave=${(config: PiWebConfigValues) => this.saveConfig(config)}
        ></settings-shortcuts-panel>
      `;
    }
    if (this.section === "packages") {
      return html`
        <settings-packages-panel
          .packagesResponse=${this.packagesResponse}
          .targetMachine=${this.packageTarget()}
          .loading=${this.packageLoading}
          .operation=${this.packageOperation}
          .error=${this.packageError}
          .operationMessage=${this.packageMessage}
          .onReload=${() => this.loadPackagesForTarget()}
          .onInstallPackage=${(source: string) => this.installPiPackage(source)}
          .onRemovePackage=${(source: string, scope: PiPackageScope) => this.removePiPackage(source, scope)}
          .onUpdatePackage=${(source?: string) => this.updatePiPackage(source)}
        ></settings-packages-panel>
      `;
    }
    if (this.section === "plugins") {
      return html`
        <settings-plugins-panel
          .configResponse=${this.selectedPluginConfigResponse}
          .pluginsResponse=${this.selectedPluginsResponse}
          .loading=${this.pluginLoading}
          .saving=${this.saving}
          .error=${this.pluginError}
          .savedMessage=${this.savedMessage}
          .targetLabel=${settingsMachineTargetLabel(this.settingsTarget())}
          .onReload=${() => this.loadPluginsForTarget()}
          .onTogglePlugin=${(pluginId: string, enabled: boolean) => this.togglePlugin(pluginId, enabled)}
        ></settings-plugins-panel>
      `;
    }
    return html`
      <settings-general-panel
        .configResponse=${this.configResponse}
        .machineConfigResponse=${this.accessConfigResponse}
        .loading=${this.loading}
        .machineLoading=${this.accessLoading}
        .saving=${this.saving}
        .error=${this.error}
        .machineError=${this.accessError}
        .savedMessage=${this.savedMessage}
        .targetLabel=${settingsMachineTargetLabel(this.settingsTarget())}
        .onReload=${() => this.loadConfig()}
        .onReloadMachine=${() => this.loadAccessConfigForTarget()}
        .onSave=${(config: PiWebConfigValues) => this.saveConfig(config)}
        .onSaveMachineConfig=${(config: PiWebConfigValues) => this.saveMachineAccessConfig(config)}
      ></settings-general-panel>
    `;
  }

  /**
   * One line per section. The old second line repeated "Selected machine" on
   * three of five tabs, and every panel already names its own target in its
   * description, so the subtitle only cost height.
   */
  private renderNavButton(section: SettingsSection, label: string): TemplateResult {
    const selected = this.section === section;
    return html`
      <button class=${selected ? "selected" : ""} aria-current=${selected ? "page" : "false"} @click=${() => { this.navigate(section); }}>${label}</button>
    `;
  }

  private navigate(section: SettingsSection): void {
    this.onNavigate?.(section);
  }

  /**
   * In the strip layout the tabs scroll horizontally, so deep-linking to a
   * later section (`?settings=shortcuts`) would otherwise open with the current
   * tab off-screen and the bar reading as though General were selected.
   *
   * Deferred by a frame: on the first update the dialog is rendered but the
   * modal surface has not been placed, so the strip has no scroll extent yet
   * and scrolling into view is a no-op.
   */
  private revealSelectedNavButton(): void {
    requestAnimationFrame(() => {
      const selected = this.renderRoot.querySelector(".settings-nav button.selected");
      selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  private async loadConfig(): Promise<void> {
    const requestSeq = ++this.loadRequestSeq;
    this.loading = true;
    this.error = "";
    try {
      const result = await loadGatewaySettingsData({
        loadConfig: () => configApi.config(),
        loadPlugins: () => pluginsApi.plugins(),
      });
      if (!this.isCurrentLoad(requestSeq)) return;

      if (result.config !== undefined) this.configResponse = result.config;
      if (result.plugins !== undefined) this.pluginsResponse = result.plugins;
      this.error = result.error;
    } finally {
      if (this.isCurrentLoad(requestSeq)) this.loading = false;
    }
  }

  private async loadAccessConfigForTarget(target = this.settingsTarget()): Promise<void> {
    const requestSeq = ++this.accessLoadRequestSeq;
    this.accessLoading = true;
    this.accessError = "";
    try {
      const response = await configApi.config(target.id);
      if (!this.isCurrentAccessLoad(requestSeq, target)) return;
      this.accessConfigResponse = response;
    } catch (error) {
      if (this.isCurrentAccessLoad(requestSeq, target)) {
        this.accessError = `Failed to load file access/upload config from ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target)}`;
      }
    } finally {
      if (this.isCurrentAccessLoad(requestSeq, target)) this.accessLoading = false;
    }
  }

  private async reloadSessiondState(target = this.settingsTarget()): Promise<void> {
    await Promise.all([
      this.loadSessiondConfigForTarget(target),
      this.onRefreshMachineRuntime?.(target.id),
    ]);
  }

  private async loadSessiondConfigForTarget(target = this.settingsTarget()): Promise<void> {
    const requestSeq = ++this.sessiondLoadRequestSeq;
    this.sessiondLoading = true;
    this.sessiondError = "";
    try {
      const response = await configApi.config(target.id);
      if (!this.isCurrentSessiondLoad(requestSeq, target)) return;
      this.sessiondConfigResponse = response;
    } catch (error) {
      if (this.isCurrentSessiondLoad(requestSeq, target)) {
        this.sessiondError = `Failed to load session-daemon config from ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target)}`;
      }
    } finally {
      if (this.isCurrentSessiondLoad(requestSeq, target)) this.sessiondLoading = false;
    }
  }

  private async loadPluginsForTarget(target = this.settingsTarget()): Promise<void> {
    const requestSeq = ++this.pluginLoadRequestSeq;
    this.pluginLoading = true;
    this.pluginError = "";
    try {
      const [config, plugins] = await Promise.allSettled([configApi.config(target.id), pluginsApi.plugins(target.id)]);
      if (!this.isCurrentPluginLoad(requestSeq, target)) return;

      const errors: string[] = [];
      if (config.status === "fulfilled") this.selectedPluginConfigResponse = config.value;
      else errors.push(`config: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(config.reason), target)}`);

      if (plugins.status === "fulfilled") this.selectedPluginsResponse = plugins.value;
      else errors.push(`Forgerie plugins: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(plugins.reason), target)}`);

      this.pluginError = errors.length === 0 ? "" : `Failed to load Forgerie plugin settings from ${settingsMachineTargetLabel(target)}: ${errors.join("; ")}`;
    } finally {
      if (this.isCurrentPluginLoad(requestSeq, target)) this.pluginLoading = false;
    }
  }

  private async loadPackagesForTarget(target = this.packageTarget()): Promise<void> {
    const requestSeq = ++this.packageLoadRequestSeq;
    this.packageLoading = true;
    this.packageError = "";
    this.packageMessage = "";
    try {
      const result = await loadPiPackagesData(target, (targetId) => piPackagesApi.packages(targetId));
      if (!this.isCurrentPackageLoad(requestSeq, target)) return;

      this.packagesResponse = result.packagesResponse;
      this.packageError = result.error;
    } finally {
      if (this.isCurrentPackageLoad(requestSeq, target)) this.packageLoading = false;
    }
  }

  private async togglePlugin(pluginId: string, enabled: boolean): Promise<void> {
    if (this.saving) return;
    const target = this.settingsTarget();
    if (this.selectedPluginConfigResponse === undefined) {
      this.pluginError = `Plugin config is not loaded for ${settingsMachineTargetLabel(target)}. Reload before changing plugin enablement.`;
      return;
    }
    const patch = pluginEnabledConfigPatch(this.selectedPluginConfigResponse.config, pluginId, enabled);
    this.saving = true;
    this.pluginError = "";
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(patch, target.id);
      if (!this.isCurrentSettingsTarget(target)) return;
      this.selectedPluginConfigResponse = response;
      if (target.kind === "local" && this.configResponse !== undefined) {
        this.configResponse = mergeSelectedMachinePluginConfig(this.configResponse, response);
        this.onConfigSaved?.(this.configResponse.effectiveConfig);
      }
      const pluginRefreshError = await this.refreshPluginsForTarget(target);
      if (!this.isCurrentSettingsTarget(target)) return;
      if (pluginRefreshError !== undefined) this.pluginError = pluginRefreshError;
      this.showSavedMessage();
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) {
        this.pluginError = `Failed to save Forgerie plugin config on ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target)}`;
      }
    } finally {
      this.saving = false;
    }
  }

  private async saveConfig(config: PiWebConfigValues): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.error = "";
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(config);
      this.configResponse = response;
      this.onConfigSaved?.(response.effectiveConfig);
      this.showSavedMessage();
    } catch (error) {
      this.error = `Failed to save config: ${errorMessage(error)}`;
    } finally {
      this.saving = false;
    }
  }

  private async saveMachineAccessConfig(config: PiWebConfigValues): Promise<void> {
    if (this.saving) return;
    const target = this.settingsTarget();
    this.saving = true;
    this.accessError = "";
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(config, target.id);
      if (!this.isCurrentSettingsTarget(target)) return;
      this.accessConfigResponse = response;
      if (target.kind === "local" && this.configResponse !== undefined) {
        this.configResponse = mergeSelectedMachineAccessConfig(this.configResponse, response);
        this.onConfigSaved?.(this.configResponse.effectiveConfig);
      }
      this.showSavedMessage();
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) {
        this.accessError = `Failed to save file access/upload config on ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target)}`;
      }
    } finally {
      this.saving = false;
    }
  }

  private async saveSessiondConfig(config: PiWebConfigValues): Promise<void> {
    if (this.saving) return;
    const target = this.settingsTarget();
    this.saving = true;
    this.sessiondError = "";
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(config, target.id);
      if (!this.isCurrentSettingsTarget(target)) return;
      this.sessiondConfigResponse = response;
      if (target.kind === "local" && this.configResponse !== undefined) this.configResponse = mergeSelectedMachineSessiondConfig(this.configResponse, response);
      this.showSavedMessage();
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) {
        this.sessiondError = `Failed to save session-daemon config on ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target)}`;
      }
    } finally {
      this.saving = false;
    }
  }

  private async installPiPackage(source: string): Promise<void> {
    const target = this.packageTarget();
    await this.runPiPackageMutation({ kind: "install", source }, "install Pi package", target, () => piPackagesApi.install(source, target.id));
  }

  private async removePiPackage(source: string, scope: PiPackageScope): Promise<void> {
    const target = this.packageTarget();
    await this.runPiPackageMutation({ kind: "remove", source }, "remove Pi package", target, () => piPackagesApi.remove(source, scope, target.id));
  }

  private async updatePiPackage(source?: string): Promise<void> {
    const target = this.packageTarget();
    await this.runPiPackageMutation(source === undefined ? { kind: "update-all" } : { kind: "update", source }, "update Pi packages", target, () => piPackagesApi.update(source, target.id));
  }

  private async runPiPackageMutation(operation: PiPackageOperationState, label: string, target: PiPackageTargetContext, mutate: () => Promise<PiPackageMutationResponse>): Promise<void> {
    if (this.saving) throw new Error("A settings operation is already running.");
    const requestSeq = ++this.packageMutationSeq;
    this.packageLoadRequestSeq += 1;
    this.packageLoading = false;
    this.saving = true;
    this.packageOperation = operation;
    this.packageError = "";
    this.packageMessage = "";
    try {
      const response = await mutate();
      if (!this.isCurrentPackageMutation(requestSeq, target)) return;
      this.packagesResponse = { packages: response.packages };
      const pluginRefreshError = shouldRefreshGatewayPluginsAfterPiPackageMutation(target) ? await this.refreshGatewayPlugins() : undefined;
      if (!this.isCurrentPackageMutation(requestSeq, target)) return;
      if (pluginRefreshError !== undefined) this.packageError = pluginRefreshError;
      this.packageMessage = piPackageMutationFollowUpMessage(response.action, target);
    } catch (error) {
      if (this.isCurrentPackageMutation(requestSeq, target)) this.packageError = `Failed to ${label} on ${piPackageTargetLabel(target)}: ${friendlyPiPackageErrorMessage(errorMessage(error), target)}`;
      throw error;
    } finally {
      if (this.packageMutationSeq === requestSeq) {
        this.packageOperation = undefined;
        this.saving = false;
      }
    }
  }

  private async refreshGatewayPlugins(): Promise<string | undefined> {
    try {
      this.pluginsResponse = await pluginsApi.plugins();
      return undefined;
    } catch (error) {
      return `Failed to refresh gateway Forgerie plugins: ${errorMessage(error)}`;
    }
  }

  private async refreshPluginsForTarget(target: SettingsMachineTarget): Promise<string | undefined> {
    try {
      const response = await pluginsApi.plugins(target.id);
      if (this.isCurrentSettingsTarget(target)) this.selectedPluginsResponse = response;
      return undefined;
    } catch (error) {
      return `Config saved, but failed to refresh Forgerie plugins from ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target)}`;
    }
  }

  private settingsTarget(): SettingsMachineTarget {
    return settingsMachineTarget(this.machine);
  }

  private packageTarget(): PiPackageTargetContext {
    return this.settingsTarget();
  }

  private isCurrentLoad(requestSeq: number): boolean {
    return requestSeq === this.loadRequestSeq;
  }

  private isCurrentAccessLoad(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.accessLoadRequestSeq && this.isCurrentSettingsTarget(target);
  }

  private isCurrentSessiondLoad(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.sessiondLoadRequestSeq && this.isCurrentSettingsTarget(target);
  }

  private isCurrentPluginLoad(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.pluginLoadRequestSeq && this.isCurrentSettingsTarget(target);
  }

  private isCurrentPackageLoad(requestSeq: number, target: PiPackageTargetContext): boolean {
    return requestSeq === this.packageLoadRequestSeq && this.isCurrentPackageTarget(target);
  }

  private isCurrentPackageMutation(requestSeq: number, target: PiPackageTargetContext): boolean {
    return requestSeq === this.packageMutationSeq && this.isCurrentPackageTarget(target);
  }

  private isCurrentPackageTarget(target: PiPackageTargetContext): boolean {
    return this.packageTarget().id === target.id;
  }

  private isCurrentSettingsTarget(target: SettingsMachineTarget): boolean {
    return this.settingsTarget().id === target.id;
  }

  private resetAccessStateForTargetChange(): void {
    this.accessLoadRequestSeq += 1;
    this.accessLoading = false;
    this.accessError = "";
    this.accessConfigResponse = undefined;
    this.savedMessage = "";
  }

  private resetSessiondStateForTargetChange(): void {
    this.sessiondLoadRequestSeq += 1;
    this.sessiondLoading = false;
    this.sessiondError = "";
    this.sessiondConfigResponse = undefined;
    this.savedMessage = "";
  }

  private resetPluginStateForTargetChange(): void {
    this.pluginLoadRequestSeq += 1;
    this.pluginLoading = false;
    this.pluginError = "";
    this.selectedPluginConfigResponse = undefined;
    this.selectedPluginsResponse = undefined;
    this.savedMessage = "";
  }

  private resetPackageStateForTargetChange(): void {
    const hadPackageOperation = this.packageOperation !== undefined;
    this.packageLoadRequestSeq += 1;
    this.packageMutationSeq += 1;
    this.packageLoading = false;
    this.packageOperation = undefined;
    this.packageMessage = "";
    this.packageError = "";
    this.packagesResponse = undefined;
    if (hadPackageOperation) this.saving = false;
  }

  private showSavedMessage(): void {
    this.savedMessage = "Config saved.";
    if (this.savedMessageTimer !== undefined) window.clearTimeout(this.savedMessageTimer);
    this.savedMessageTimer = window.setTimeout(() => {
      if (this.savedMessage === "Config saved.") this.savedMessage = "";
      this.savedMessageTimer = undefined;
    }, 3000);
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 30; color: var(--pi-text); font: var(--pi-text-md) system-ui, sans-serif; container-type: inline-size; }
    modal-surface { --modal-surface-backdrop-padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); --modal-surface-width: min(980px, 100%); --modal-surface-max-height: min(760px, 100%); --modal-surface-min-height: min(620px, 100%); --modal-surface-radius: 14px; }
    button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-inline); background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; font: inherit; cursor: pointer; }

    /*
     * The dialog used to open with a 63px band carrying an eyebrow reading
     * SETTINGS above a title reading Forgerie -- two labels for a surface the
     * user just opened, above a tab bar that names the section anyway. The band
     * is gone; the close button rides the tab bar, and modal-surface still
     * carries "Forgerie settings" as the dialog's accessible name.
     */
    .settings-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); }
    .settings-chrome { display: flex; flex-direction: column; width: 200px; min-height: 0; padding: 8px; border-right: 1px solid var(--pi-border); background: var(--pi-surface); }
    /*
     * Selection is an edge marker, not a filled rounded bubble. A pill per tab
     * inside a rounded dialog stacked three radii on one control; a 2px rule on
     * the edge the tabs run along says the same thing with no shape.
     */
    .settings-nav { min-height: 0; display: flex; flex-direction: column; gap: 0; overflow: auto; }
    .settings-nav button { width: 100%; text-align: left; border: 0; border-radius: 0; background: transparent; color: var(--pi-muted); padding: 9px 10px; }
    .settings-nav button:hover, .settings-nav button:focus-visible { background: var(--pi-surface-hover); color: var(--pi-text); }
    .settings-nav button.selected { color: var(--pi-text); background: transparent; box-shadow: inset 2px 0 0 var(--pi-accent); }
    /*
     * Close is first in the DOM and first visually in both layouts, so tab
     * order matches reading order. Leading placement also matches the platform
     * convention on the acceptance device, where dismiss sits at the top-left.
     */
    .close-button { align-self: flex-start; flex: 0 0 auto; width: 40px; height: 40px; display: grid; place-items: center; border: 0; background: transparent; color: var(--pi-muted); padding: 0; font-size: 22px; }
    .close-button:hover, .close-button:focus { color: var(--pi-text); background: var(--pi-surface-hover); }
    .settings-content { min-width: 0; min-height: 0; overflow: auto; padding: 14px 16px; }

    @container (max-width: 760px) {
      modal-surface { --modal-surface-backdrop-padding: 0; --modal-surface-place-items: stretch; --modal-surface-width: 100%; --modal-surface-max-height: none; --modal-surface-min-height: 0; --modal-surface-border: 0; --modal-surface-radius: 0; }
      .settings-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
      .settings-chrome { flex-direction: row; align-items: center; gap: 4px; width: auto; padding: max(4px, env(safe-area-inset-top)) 4px 4px; border-right: 0; border-bottom: 1px solid var(--pi-border); }
      .settings-nav { flex: 1 1 auto; flex-direction: row; overflow-x: auto; overflow-y: hidden; }
      .settings-nav button { flex: 0 0 auto; width: auto; padding: 10px 12px; }
      /* The strip runs horizontally, so the marker moves to its bottom edge. */
      .settings-nav button.selected { box-shadow: inset 0 -2px 0 var(--pi-accent); }
      .close-button { align-self: center; }
      .settings-content { padding: 12px 12px calc(16px + env(safe-area-inset-bottom)); }
    }
  `;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type SettingsPanelTag =
  | "settings-general-panel"
  | "settings-sessiond-panel"
  | "settings-packages-panel"
  | "settings-plugins-panel"
  | "settings-shortcuts-panel";

/**
 * The single custom-element panel the settings dialog renders for a section.
 *
 * This is the public routing contract behind `renderActiveSection`: each section
 * maps to exactly one panel element and nothing else (no per-tab "scope note"
 * wrapper). Tests assert this mapping instead of inspecting the rendered
 * `TemplateResult`'s markup.
 */
export function activeSettingsPanelTag(section: SettingsSection): SettingsPanelTag {
  switch (section) {
    case "sessiond":
      return "settings-sessiond-panel";
    case "packages":
      return "settings-packages-panel";
    case "plugins":
      return "settings-plugins-panel";
    case "shortcuts":
      return "settings-shortcuts-panel";
    case "general":
      return "settings-general-panel";
  }
}
