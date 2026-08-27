import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppAction } from "../../actions";
import type { PiWebConfigResponse, PiWebConfigValues, PiWebShortcutConfig } from "../../api";
import { formatShortcut, isShortcutSequenceStarter, parseShortcutInput, shortcutSequenceTimeoutMs, shortcutTokenFromEvent } from "../../keyboardShortcuts";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import {
  appendRecordedToken,
  closeShortcutEditor,
  deriveShortcutSettingsList,
  editorShortcut,
  openShortcutMenu,
  rowEditorFor,
  shortcutBindingLabel,
  shortcutBindingShortcut,
  startRecording,
  startTyping,
  type ShortcutConflictState,
  type ShortcutEditor,
  type ShortcutListRow,
} from "./shortcutSettingsList";

const RECORD_SHORTCUT_LISTENER_OPTIONS = { capture: true } as const;

/**
 * Keyboard shortcuts settings.
 *
 * The collapsed row is one line — name, shortcut chip, overflow. Tapping the
 * chip records in place; the overflow menu carries the three remaining verbs
 * plus "Type a shortcut instead", which is the only entry path that works
 * without a hardware keyboard (`isShortcutSequenceStarter` requires `ctrl` or
 * `alt` in the first chord, and on-screen keyboards emit neither).
 *
 * All row state lives in `shortcutSettingsList`; this element composes it.
 */
@customElement("settings-shortcuts-panel")
export class SettingsShortcutsPanel extends LitElement {
  @property({ attribute: false }) actions: AppAction[] = [];
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues) => void | Promise<void>;
  @state() private editor: ShortcutEditor = { kind: "closed" };
  @state() private filter = "";
  @state() private localError = "";
  private recordingTimer: number | undefined;
  private recordingListenerActive = false;

  private readonly onRecordKeyDown = (event: KeyboardEvent): void => {
    if (this.editor.kind !== "recording") return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      this.closeEditor();
      return;
    }
    if (event.metaKey || event.key === "Meta") {
      this.localError = "Only Ctrl, Alt, and Shift modifiers are supported. Esc cancels.";
      return;
    }

    const token = shortcutTokenFromEvent(event);
    if (token === undefined) {
      this.localError = "Press a letter, number, punctuation, function, or navigation key. Esc cancels.";
      return;
    }
    if (this.editor.tokens.length === 0 && !isShortcutSequenceStarter(token)) {
      this.localError = "Start with Ctrl or Alt.";
      return;
    }

    this.localError = "";
    this.editor = appendRecordedToken(this.editor, token);
    this.armRecordingTimer();
  };

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("configResponse") && this.configResponse !== undefined) {
      this.localError = "";
      this.stopRecording();
      this.editor = closeShortcutEditor();
    }
  }

  override disconnectedCallback(): void {
    this.stopRecording();
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    return html`
      <settings-panel-frame
        heading="Keyboard shortcuts"
        .description=${this.renderDescription()}
        actionLabel="Reload"
        .actionDisabled=${this.loading}
        .notices=${this.panelNotices()}
        .onAction=${this.onReload}
      >
        ${this.renderBody()}
      </settings-panel-frame>
    `;
  }

  /**
   * The config path used to be a 96px card. It is reference material read once,
   * so it collapses into the frame description as a disclosure.
   */
  private renderDescription(): TemplateResult {
    return html`
      <details class="config-note">
        <summary>How overrides work</summary>
        <p>
          Tap a shortcut to record it, or choose <em>Type a shortcut instead</em> from the row menu and enter one such as
          <code>ctrl+shift+p</code> or <code>ctrl+k ctrl+s</code>. Custom shortcuts win over defaults.
        </p>
        <p>
          Overrides are saved under <code>shortcuts</code>${this.configResponse === undefined ? nothing : html` in <code>${this.configResponse.path}</code>`};
          <code>null</code> disables a shortcut.
        </p>
      </details>
    `;
  }

  private renderBody(): TemplateResult {
    if (this.configResponse === undefined && this.loading) {
      return html`<div class="loading-card">Loading shortcuts…</div>`;
    }
    if (this.actions.length === 0) {
      return html`<div class="loading-card">No actions registered.</div>`;
    }

    const list = deriveShortcutSettingsList({
      actions: this.actions,
      shortcuts: this.configResponse?.config.shortcuts ?? {},
      filter: this.filter,
      editor: this.editor,
    });

    return html`
      <div class="list">
        <div class="filter-bar">
          <input
            class="filter-input"
            type="search"
            .value=${this.filter}
            placeholder="Filter actions and shortcuts…"
            aria-label="Filter shortcuts"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            @input=${(event: Event) => { this.filter = inputValue(event); }}
          >
          <span class="filter-count">${list.shown === list.total ? `${String(list.total)} · ${String(list.customCount)} custom` : `${String(list.shown)}/${String(list.total)}`}</span>
        </div>
        ${list.shown === 0 ? html`<div class="loading-card">No action matches that filter.</div>` : list.groups.map((group) => html`
          <section class="group">
            <h3>${group.name}<span>${group.rows.length}</span></h3>
            <div class="rows">${group.rows.map((row) => this.renderRow(row))}</div>
          </section>
        `)}
      </div>
    `;
  }

  private renderRow(row: ShortcutListRow): TemplateResult {
    const editor = rowEditorFor(this.editor, row.action.id);
    const recording = editor.kind === "recording";
    const open = editor.kind !== "closed";
    return html`
      <div class=${rowHostClass(row, open)}>
        <div class="row">
          <span class="row-name" title=${row.action.description ?? row.action.title}>
            ${row.action.title}
            ${row.conflict.kind === "clear" ? nothing : html`<i class=${`dot ${row.conflict.kind}`} title=${conflictText(row.conflict)}></i>`}
          </span>
          <button
            class=${chipClass(row, recording)}
            ?disabled=${this.saving}
            aria-label=${`${recording ? "Stop recording" : "Record"} shortcut for ${row.action.title}`}
            @click=${() => { this.toggleRecording(row.action.id); }}
          >${chipLabel(row, editor)}</button>
          <button
            class="more"
            ?disabled=${this.saving}
            aria-expanded=${open ? "true" : "false"}
            aria-label=${`More options for ${row.action.title}`}
            @click=${() => { this.toggleMenu(row.action.id); }}
          >⋯</button>
        </div>
        ${open ? this.renderRowPanel(row, editor) : nothing}
      </div>
    `;
  }

  private renderRowPanel(row: ShortcutListRow, editor: ShortcutEditor): TemplateResult {
    return html`
      <div class="row-panel">
        <div class="row-facts">
          <code>${row.action.id}</code>
          <span>${row.action.shortcut === undefined || row.action.shortcut === "" ? "No default" : `Default ${formatShortcut(row.action.shortcut)}`}</span>
        </div>
        ${row.action.description === undefined || row.action.description === "" ? nothing : html`<p class="row-desc">${row.action.description}</p>`}
        ${editor.kind === "typing" ? this.renderTypeField(row, editor.draft) : nothing}
        ${this.renderRowHint(row, editor)}
        ${editor.kind === "typing" ? nothing : html`
          <div class="row-verbs">
            <button ?disabled=${this.saving} @click=${() => { this.toggleRecording(row.action.id); }}>${editor.kind === "recording" ? "Stop recording" : "Record a new shortcut"}</button>
            <button ?disabled=${this.saving} @click=${() => { this.beginTyping(row); }}>Type a shortcut instead</button>
            <button ?disabled=${this.saving || row.saved.kind === "disabled"} @click=${() => { void this.saveShortcut(row.action.id, null); }}>Disable this shortcut</button>
            <button ?disabled=${this.saving || !row.overridden} @click=${() => { void this.saveShortcut(row.action.id, undefined); }}>Reset to default</button>
          </div>
        `}
      </div>
    `;
  }

  private renderTypeField(row: ShortcutListRow, draft: string): TemplateResult {
    return html`
      <div class="type-row">
        <input
          class="type-input"
          data-action-id=${row.action.id}
          .value=${draft}
          placeholder=${row.action.shortcut ?? "ctrl+k"}
          aria-label=${`Shortcut for ${row.action.title}`}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          ?disabled=${this.saving}
          @input=${(event: Event) => { this.editor = startTyping(row.action.id, inputValue(event)); this.localError = ""; }}
          @keydown=${(event: KeyboardEvent) => { this.onTypeKeyDown(event, row); }}
        >
        <button class="primary" ?disabled=${this.saving || !row.dirty} @click=${() => { void this.commitTyped(row); }}>Save</button>
        <button ?disabled=${this.saving} @click=${() => { this.closeEditor(); }}>Cancel</button>
      </div>
    `;
  }

  private renderRowHint(row: ShortcutListRow, editor: ShortcutEditor): TemplateResult | typeof nothing {
    if (editor.kind === "recording") {
      return html`<p class="hint live">${editor.tokens.length === 0
        ? "Recording — press Ctrl or Alt with a key. Esc cancels."
        : `Recording ${formatShortcut(editor.tokens.join(" "))} — press another key for a sequence, or wait to finish.`}</p>`;
    }
    if (editor.kind === "typing") {
      // Save is disabled while the draft cannot be parsed, so the reason has to
      // be visible here or the button just looks broken.
      const problem = draftProblem(editor.draft);
      if (problem !== undefined) return html`<p class="hint warn">${problem}</p>`;
      if (row.conflict.kind !== "clear") return html`<p class="hint warn">${conflictText(row.conflict)}</p>`;
      return html`<p class="hint">Use Ctrl, Alt, and Shift only. Separate a sequence with a space.</p>`;
    }
    if (row.conflict.kind !== "clear") return html`<p class="hint warn">${conflictText(row.conflict)}</p>`;
    return nothing;
  }

  private panelNotices(): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    const error = this.localError || this.error;
    if (error !== "") notices.push({ type: "error", content: error });
    if (this.savedMessage !== "") notices.push({ type: "success", content: this.savedMessage });
    return notices;
  }

  private toggleMenu(actionId: string): void {
    this.stopRecording();
    this.localError = "";
    this.editor = openShortcutMenu(this.editor, actionId);
  }

  private toggleRecording(actionId: string): void {
    const next = startRecording(this.editor, actionId);
    this.stopRecording();
    this.localError = "";
    this.editor = next;
    if (next.kind === "recording") this.ensureRecordingListener();
  }

  private beginTyping(row: ShortcutListRow): void {
    this.stopRecording();
    this.localError = "";
    this.editor = startTyping(row.action.id, shortcutBindingShortcut(row.saved));
    void this.focusTypeField(row.action.id);
  }

  private closeEditor(): void {
    this.stopRecording();
    this.localError = "";
    this.editor = closeShortcutEditor();
  }

  private onTypeKeyDown(event: KeyboardEvent, row: ShortcutListRow): void {
    if (event.key === "Escape") { event.stopPropagation(); this.closeEditor(); return; }
    if (event.key !== "Enter") return;
    event.preventDefault();
    void this.commitTyped(row);
  }

  private async commitTyped(row: ShortcutListRow): Promise<void> {
    if (this.editor.kind !== "typing") return;
    const parsed = parseShortcutInput(this.editor.draft);
    if (!parsed.ok) {
      this.localError = parsed.message;
      return;
    }
    await this.saveShortcut(row.action.id, parsed.shortcut);
  }

  private async focusTypeField(actionId: string): Promise<void> {
    await this.updateComplete;
    for (const input of this.renderRoot.querySelectorAll<HTMLInputElement>(".type-input")) {
      if (input.dataset["actionId"] === actionId) { input.focus(); input.select(); return; }
    }
  }

  private async saveShortcut(actionId: string, shortcut: string | null | undefined): Promise<void> {
    this.stopRecording();
    this.localError = "";
    this.editor = closeShortcutEditor();
    const config: PiWebConfigValues = { ...(this.configResponse?.config ?? {}) };
    const currentShortcuts = config.shortcuts ?? {};
    const shortcuts = shortcut === undefined
      ? withoutShortcutPreference(currentShortcuts, actionId)
      : { ...currentShortcuts, [actionId]: shortcut };
    if (Object.keys(shortcuts).length === 0) delete config.shortcuts;
    else config.shortcuts = shortcuts;
    await this.onSave?.(config);
  }

  /**
   * Recording commits when the sequence settles rather than on a Save button:
   * the chip is the control, so there is nothing else to press.
   */
  private armRecordingTimer(): void {
    this.clearRecordingTimer();
    this.recordingTimer = window.setTimeout(() => {
      this.recordingTimer = undefined;
      const shortcut = editorShortcut(this.editor);
      const actionId = this.editor.kind === "recording" ? this.editor.actionId : undefined;
      this.removeRecordingListener();
      if (actionId === undefined || shortcut === undefined) { this.editor = closeShortcutEditor(); return; }
      void this.saveShortcut(actionId, shortcut);
    }, shortcutSequenceTimeoutMs);
  }

  private stopRecording(): void {
    this.clearRecordingTimer();
    this.removeRecordingListener();
  }

  private clearRecordingTimer(): void {
    if (this.recordingTimer === undefined) return;
    window.clearTimeout(this.recordingTimer);
    this.recordingTimer = undefined;
  }

  private ensureRecordingListener(): void {
    if (this.recordingListenerActive) return;
    window.addEventListener("keydown", this.onRecordKeyDown, RECORD_SHORTCUT_LISTENER_OPTIONS);
    this.recordingListenerActive = true;
  }

  private removeRecordingListener(): void {
    if (!this.recordingListenerActive) return;
    window.removeEventListener("keydown", this.onRecordKeyDown, RECORD_SHORTCUT_LISTENER_OPTIONS);
    this.recordingListenerActive = false;
  }

  static override styles = css`
    :host { display: block; container-type: inline-size; }
    h3 { margin: 0; font-size: var(--pi-text-sm); line-height: 1.3; }
    button, input { font: inherit; }
    button:disabled, input:disabled { opacity: .55; cursor: not-allowed; }
    code { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-inline); background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: var(--pi-text-xs) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .loading-card { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-surface); background: var(--pi-surface); padding: var(--pi-space-md); color: var(--pi-muted); }

    .config-note summary { cursor: pointer; color: var(--pi-muted); font-size: var(--pi-text-sm); }
    .config-note p { margin: 6px 0 0; color: var(--pi-muted); font-size: var(--pi-text-sm); line-height: 1.45; }

    .list { display: grid; gap: 10px; }

    /* Search beats scrolling once the registry passes a screenful of actions. */
    .filter-bar { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 8px; padding: 4px 0; background: var(--pi-bg); }
    .filter-input { flex: 1 1 auto; min-width: 0; box-sizing: border-box; height: 40px; padding: 0 10px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-inline); background: var(--pi-surface); color: var(--pi-text); outline: none; font: var(--pi-control-font-size, 16px) system-ui, sans-serif; }
    .filter-input:focus { border-color: var(--pi-accent); box-shadow: 0 0 0 1px var(--pi-accent-border); }
    .filter-count { flex: 0 0 auto; color: var(--pi-dim, var(--pi-muted)); font: var(--pi-text-xs) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

    .group h3 { position: sticky; top: 52px; z-index: 2; display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; padding: 3px 0; background: var(--pi-bg); color: var(--pi-muted); font-size: var(--pi-text-xs); text-transform: uppercase; letter-spacing: .06em; }
    .group h3 span { color: var(--pi-border); letter-spacing: 0; }

    /*
     * A flat ruled list, not a card. The 12px rounded surface around every
     * group put a second container inside a dialog that is already a container,
     * and rounded corners on a list of 42 one-line rows read as decoration.
     * The sticky group heading does the grouping instead.
     */
    .rows { border-top: 1px solid var(--pi-border-muted); }
    .row-host { border-bottom: 1px solid var(--pi-border-muted); }
    .row-host.open { background: var(--pi-selection-bg); }
    .row-host.shadowed, .row-host.conflict { background: color-mix(in srgb, var(--pi-warning) 6%, transparent); }

    /*
     * 40px of ink inside a 44px target. The description and action id are not
     * here on purpose — they are reference detail, and they reappear in the row
     * panel when a row is opened.
     */
    .row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 8px; min-height: 44px; padding: 0 10px; }
    .row-name { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--pi-text-sm); }
    .row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* A binding that never fires is the one thing worth spotting mid-scan. */
    .dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; }
    .dot.shadowed, .dot.conflict, .dot.partial-conflict, .dot.partial-shadowed { background: var(--pi-warning); }
    .dot.shadows { background: var(--pi-accent); }

    /*
     * The chip is a keycap, so it is shaped like one: a 4px corner and a
     * weighted bottom edge. A 999px pill said "tag", which is the wrong verb
     * for something you press to record a key.
     */
    .chip { min-height: 30px; padding: 3px 8px; border: 1px solid var(--pi-border); border-bottom-width: 2px; border-radius: var(--pi-radius-inline); background: var(--pi-bg); color: var(--pi-text-secondary); font: var(--pi-text-xs) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; cursor: pointer; }
    .chip:hover:not(:disabled) { border-color: var(--pi-accent-border); color: var(--pi-text); }
    .chip.custom { border-color: var(--pi-accent-border); color: var(--pi-accent); }
    .chip.empty { border-style: dashed; border-bottom-width: 1px; color: var(--pi-muted); }
    .chip.recording { border-color: var(--pi-accent); background: var(--pi-selection-bg); color: var(--pi-text); }
    .more { width: 30px; height: 30px; border: 0; border-radius: var(--pi-radius-inline); background: transparent; color: var(--pi-muted); cursor: pointer; }
    .more:hover:not(:disabled) { color: var(--pi-text); background: var(--pi-surface-hover); }

    .row-panel { display: grid; gap: 8px; padding: 4px 10px 10px; }
    .row-facts { display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .row-desc { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1.45; }
    .hint { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .hint.live { color: var(--pi-accent); }
    .hint.warn { color: var(--pi-warning); }

    /* Verbs gain columns from available space rather than a fixed count. */
    .row-verbs { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 6px; }
    .row-verbs button { min-height: 40px; padding: 0 10px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-inline); background: var(--pi-surface); color: var(--pi-text); font-size: var(--pi-text-xs); text-align: left; cursor: pointer; }
    .row-verbs button:hover:not(:disabled) { background: var(--pi-surface-hover); }

    .type-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px; }
    .type-input { box-sizing: border-box; width: 100%; min-width: 0; height: 44px; padding: 0 10px; border: 1px solid var(--pi-accent); border-radius: var(--pi-radius-inline); background: var(--pi-bg); color: var(--pi-text); outline: none; font: var(--pi-control-font-size, 16px) var(--pi-control-monospace-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
    .type-row button { min-height: 44px; padding: 0 12px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-inline); background: var(--pi-surface); color: var(--pi-text); font-size: var(--pi-text-xs); cursor: pointer; }
    .type-row .primary { border-color: var(--pi-accent-border); background: var(--pi-accent); color: var(--pi-bg); }

    /*
     * There is deliberately no width query here. The panel measures 451-680px
     * across the Fold 8 posture matrix, so any threshold wide enough to fit a
     * description inline would either never fire (dead code, which is what the
     * old 760px two-column rule was) or fire for some postures and not others,
     * changing the row's content when the device is rotated. The description
     * lives in the row panel and in the row's tooltip instead.
     */
  `;
}

function rowHostClass(row: ShortcutListRow, open: boolean): string {
  const classes = ["row-host"];
  if (open) classes.push("open");
  if (row.conflict.kind === "shadowed" || row.conflict.kind === "partial-shadowed") classes.push("shadowed");
  if (row.conflict.kind === "conflict" || row.conflict.kind === "partial-conflict") classes.push("conflict");
  return classes.join(" ");
}

function chipClass(row: ShortcutListRow, recording: boolean): string {
  if (recording) return "chip recording";
  if (shortcutBindingShortcut(row.state) === "") return "chip empty";
  return row.state.kind === "custom" ? "chip custom" : "chip";
}

function chipLabel(row: ShortcutListRow, editor: ShortcutEditor): string {
  if (editor.kind === "recording") {
    return editor.tokens.length === 0 ? "press keys…" : formatShortcut(editor.tokens.join(" "));
  }
  if (row.display !== "") return row.display;
  return row.state.kind === "disabled" ? "off" : "set…";
}

/** The reason a typed draft cannot be saved, or undefined when it is fine or still empty. */
function draftProblem(draft: string): string | undefined {
  if (draft.trim() === "") return undefined;
  const parsed = parseShortcutInput(draft);
  return parsed.ok ? undefined : parsed.message;
}

function conflictText(conflict: ShortcutConflictState): string {
  if (conflict.kind === "shadowed") return `Never fires — ${conflict.winner} wins this key`;
  if (conflict.kind === "conflict") return `Conflicts with ${formatPeerList(conflict.peers)}. Neither shortcut runs.`;
  if (conflict.kind === "partial-conflict") return `Conflicts with ${formatPeerList(conflict.peers)} where both commands apply.`;
  if (conflict.kind === "partial-shadowed") return `Overridden by ${formatPeerList(conflict.winners)} where both commands apply.`;
  if (conflict.kind === "shadows") return `Overrides ${formatPeerList(conflict.victims)}`;
  return "";
}

function formatPeerList(peers: readonly string[]): string {
  const [first, ...rest] = peers;
  if (rest.length === 0) return first ?? "another action";
  return `${first ?? "another action"} +${String(rest.length)}`;
}

function withoutShortcutPreference(shortcuts: PiWebShortcutConfig, actionId: string): PiWebShortcutConfig {
  return Object.fromEntries(Object.entries(shortcuts).filter(([shortcutActionId]) => shortcutActionId !== actionId));
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-shortcuts-panel": SettingsShortcutsPanel;
  }
}

export { shortcutBindingLabel };
