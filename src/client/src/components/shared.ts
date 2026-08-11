import { css, svg, type TemplateResult } from "lit";
import type { AskUserOutcome, ProcessNotificationDetails } from "../../../shared/apiTypes";
import type { SessionWarningSeverity } from "../api";

export function renderSessionWarningIcon(severity: SessionWarningSeverity, className: string): TemplateResult {
  if (severity === "error") {
    return svg`
      <svg class=${className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="m15 9-6 6"></path>
        <path d="m9 9 6 6"></path>
      </svg>
    `;
  }
  if (severity === "info") {
    return svg`
      <svg class=${className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M12 11v5"></path>
        <path d="M12 8h.01"></path>
      </svg>
    `;
  }
  return svg`
    <svg class=${className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.3 3.7 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"></path>
      <path d="M12 9v4"></path>
      <path d="M12 17h.01"></path>
    </svg>
  `;
}

export interface ToolPreview {
  diff?: string;
  firstChangedLine?: number;
  error?: string;
}

export interface ToolExecutionPart {
  type: "toolExecution";
  toolCallId?: string;
  toolName: string;
  summary: string;
  args?: unknown;
  status: "pending" | "running" | "success" | "error";
  resultText?: string;
  content?: unknown;
  details?: unknown;
  preview?: ToolPreview;
}

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "thinking"; text: string }
  | { type: "skillInvocation"; name: string; location: string; content: string }
  | { type: "skillRead"; name: string; path: string; toolCallId?: string }
  | { type: "askUserRecord"; outcome: AskUserOutcome }
  | { type: "processNotification"; kind: ProcessNotificationDetails["kind"]; processName: string; summary: string; status?: ProcessNotificationDetails["status"]; exitCode?: number; rawContent: string }
  | { type: "toolCall"; toolCallId?: string; toolName: string; summary: string; args?: unknown }
  | ToolExecutionPart
  | { type: "toolResult"; toolCallId?: string; toolName: string; text: string; isError: boolean; content?: unknown; details?: unknown }
  | { type: "empty" };

export interface ChatLine {
  role: "user" | "assistant" | "tool" | "system" | "bash" | "skill";
  parts: ChatPart[];
  /** Original user prompt when normalization splits one prompt into several visible lines. */
  promptText?: string;
  source?: "compaction" | "branch_summary";
  meta?: {
    timestamp?: string;
    model?: { provider?: string; id?: string; responseId?: string };
    /** Thinking level the assistant message was generated with, when known. */
    thinkingLevel?: string;
  };
}

export interface CompletionItem {
  kind: "command" | "file" | "model";
  replaceFrom: number;
  replaceTo: number;
  insertText: string;
  detail: string;
  description?: string;
  cursorOffset?: number;
}

export const appStyles = css`
  /* Mobile browsers already subtract browser controls from 100dvh; reserve bottom safe area only in standalone PWA modes. */
  :host { --pi-app-safe-area-bottom: 0px; position: fixed; top: 0; right: 0; left: 0; display: block; height: 100dvh; box-sizing: border-box; overflow: hidden; padding: env(safe-area-inset-top) env(safe-area-inset-right) var(--pi-app-safe-area-bottom) env(safe-area-inset-left); color: var(--pi-text); background: var(--pi-bg); font: 14px system-ui, sans-serif; }
  :host([pwa-display-mode]) { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  @media (display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui) {
    :host { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  }
  .shell { --navigation-panel-size: 340px; --workspace-panel-size: minmax(360px, 42vw); --navigation-panel-width: var(--navigation-panel-size); --workspace-panel-width: var(--workspace-panel-size); display: grid; grid-template-columns: var(--navigation-panel-width) 1px minmax(320px, 1fr) 1px var(--workspace-panel-width); height: 100%; min-height: 0; }
  aside { grid-column: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  aside app-navigation-panel { flex: 1 1 auto; min-height: 0; }
  header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--pi-border); }
  .header-actions { display: flex; align-items: center; gap: 8px; }
  /* Positioned in every layout so the summoned control sheet has a pane to fill. */
  main { position: relative; grid-column: 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .context-bar { position: relative; flex: 0 0 auto; min-width: 0; display: none; align-items: center; gap: 0; padding: 6px 0; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
  .context-bar::before, .context-bar::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .context-bar::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .context-bar::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .context-bar.can-scroll-left::before, .context-bar.can-scroll-right::after { opacity: 1; }
  .context-bar-label { display: none; }
  .context-items { flex: 1 1 auto; min-width: 0; display: flex; align-items: stretch; gap: 5px; margin: 0; padding: 0 8px; list-style: none; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scroll-padding-inline: 8px; scrollbar-width: thin; }
  .context-bar.has-context-actions .context-items { padding-right: 52px; scroll-padding-inline: 8px 52px; }
  .context-item { flex: 0 0 auto; min-width: 0; display: flex; }
  .context-actions { position: absolute; top: 6px; right: 0; bottom: 6px; z-index: 3; display: flex; align-items: center; padding: 0 8px 0 0; pointer-events: none; }
  .context-actions::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; z-index: 0; width: 26px; background: var(--pi-bg); pointer-events: none; }
  .context-chip { flex: 0 0 auto; min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; border: 1px solid var(--pi-border-muted); border-radius: 999px; background: var(--pi-surface); color: var(--pi-text); padding: 4px 8px; font: inherit; text-align: left; }
  .context-chip:hover { background: var(--pi-surface-hover); }
  .context-chip:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
  .context-chip.empty { border-style: dashed; color: var(--pi-muted); }
  .context-kind { display: none; }
  .context-value { min-width: 0; overflow: visible; text-overflow: clip; white-space: nowrap; }
  app-mobile-main-tabs { display: none; }
  .mobile-tabs-frame { position: relative; display: none; flex: 0 0 auto; min-width: 0; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
  .mobile-tabs-frame::before, .mobile-tabs-frame::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .mobile-tabs-frame::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .mobile-tabs-frame::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .mobile-tabs-frame.can-scroll-left::before, .mobile-tabs-frame.can-scroll-right::after { opacity: 1; }
  .mobile-tabs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 8px; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; }
  .mobile-tabs button { flex: 0 0 auto; white-space: nowrap; }
  .mobile-navigation-tab, .mobile-navigation-panel { display: none; }
  .mobile-tabs button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .tab-badge { display: inline-block; min-width: 14px; margin-left: 4px; border: 1px solid var(--pi-success-border); border-radius: 999px; background: var(--pi-success-surface); color: var(--pi-success); padding: 0 5px; font-size: 11px; line-height: 16px; text-align: center; }
  .navigation-panel-edge, .workspace-panel-edge { min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: visible; background: var(--pi-border-muted); z-index: 2; }
  .navigation-panel-edge { grid-column: 2; }
  .workspace-panel-edge { grid-column: 4; }
  .navigation-panel-edge-button, .workspace-panel-edge-button { position: relative; z-index: 1; box-sizing: border-box; display: grid; place-items: center; width: 18px; height: 48px; padding: 0; border: 1px solid var(--pi-border-muted); border-radius: 999px; background: var(--pi-bg); color: var(--pi-muted); opacity: .75; cursor: pointer; }
  .navigation-panel-edge-button:hover, .navigation-panel-edge-button:focus-visible, .workspace-panel-edge-button:hover, .workspace-panel-edge-button:focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); opacity: 1; }
  .shell.navigation-panel-collapsed .navigation-panel-edge-button { transform: translateX(calc(50% - .5px)); }
  .shell.workspace-panel-collapsed .workspace-panel-edge-button { transform: translateX(calc(-50% + .5px)); }
  .navigation-panel-edge-icon, .workspace-panel-edge-icon { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  workspace-panel { grid-column: 5; min-width: 0; min-height: 0; overflow: hidden; }
  @media (min-width: 1181px) {
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; }
    .shell.navigation-panel-collapsed > aside { display: none; }
    .shell.workspace-panel-collapsed { --workspace-panel-width: 0px; }
    .shell.workspace-panel-collapsed > workspace-panel { display: none; }
  }
  @media (max-width: 1180px) {
    .shell { grid-template-columns: var(--navigation-panel-width) 1px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; }
    .shell.navigation-panel-collapsed > aside { display: none; }
    aside { grid-row: 1 / 3; }
    .navigation-panel-edge { grid-row: 1 / 3; }
    main { grid-column: 3; grid-row: 1 / 3; }
    app-mobile-main-tabs { display: block; flex: 0 0 auto; min-width: 0; }
    .mobile-tabs-frame { display: flex; }
    .shell.workspace-view main { grid-row: 1; min-height: auto; }
    .shell.workspace-view > workspace-panel { grid-column: 3; grid-row: 2; display: flex; border-left: 0; }
    .shell:not(.workspace-view) > workspace-panel { display: none; }
    .workspace-panel-edge { display: none; }
    main.workspace-view chat-view, main.workspace-view prompt-editor,
    main.workspace-view .empty { display: none; }
    main.workspace-view { overflow: hidden; }
  }
  .shell.overlay-navigation { grid-template-columns: minmax(0, 1fr); }
  .shell.overlay-navigation > aside, .shell.overlay-navigation .navigation-panel-edge { display: none; }
  .shell.overlay-navigation main, .shell.overlay-navigation.workspace-view > workspace-panel { grid-column: 1; }
  .shell.overlay-navigation .context-bar { display: flex; }
  .shell.overlay-navigation .mobile-navigation-tab { display: block; }
  .shell.overlay-navigation main { position: relative; }
  /*
   * The session stays mounted underneath: navigation slides over it so scroll
   * position, drafts, and streaming output survive summoning the panel.
   */
  /*
   * The board owns the shell when it cannot dock: a drawer beside a dimmed
   * transcript would make the inbox a side quest, and on a folded phone it also
   * squeezes every row's location and time into an ellipsis.
   */
  .shell.overlay-navigation main.navigation-view .mobile-navigation-panel {
    position: absolute; inset: 0; z-index: 30; display: flex; flex-direction: column; min-height: 0; overflow: hidden;
    background: var(--pi-bg); max-width: 100%;
    animation: navigation-overlay-in 160ms ease-out;
  }
  .shell.overlay-navigation main.navigation-view .mobile-navigation-panel app-navigation-panel { flex: 1 1 auto; min-height: 0; }
  @media (prefers-reduced-motion: reduce) {
    .shell.overlay-navigation main.navigation-view .mobile-navigation-panel { animation: none; }
  }
  .shell.overlay-navigation main.navigation-view .navigation-scrim {
    position: absolute; inset: 0; z-index: 29; display: block; width: 100%; height: 100%;
    padding: 0; border: 0; border-radius: 0; background: var(--pi-shadow); cursor: pointer;
  }
  .navigation-scrim { display: none; }
  @keyframes navigation-overlay-in { from { transform: translateX(-100%); } to { transform: translateX(0); } }
  chat-view { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  prompt-editor { flex: 0 0 auto; }
  button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  .empty { margin: auto; color: var(--pi-muted); }
  .error { padding: 10px 16px; border-bottom: 1px solid var(--pi-border); color: var(--pi-danger); }

`;

export const workspacePanelStyles = css`
  :host { display: flex; flex-direction: column; min-height: 0; color: var(--pi-text); background: var(--pi-bg); font: 13px system-ui, sans-serif; container-type: inline-size; }
  header { flex: 0 0 auto; min-width: 0; border-bottom: 1px solid var(--pi-border); }
  .workspace-header-scroll-frame { position: relative; min-width: 0; background: var(--pi-bg); }
  .workspace-header-scroll-frame::before, .workspace-header-scroll-frame::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 18px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .workspace-header-scroll-frame::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .workspace-header-scroll-frame::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .workspace-header-scroll-frame.can-scroll-left::before, .workspace-header-scroll-frame.can-scroll-right::after { opacity: 1; }
  .workspace-header-strip { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0; padding: 8px; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; }
  .tabs { flex: 0 0 auto; display: flex; gap: 6px; align-items: center; }
  .tabs button { flex: 0 0 auto; white-space: nowrap; }
  .tabs button.icon-tab { min-width: 34px; }
  button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--pi-border); border-radius: 7px; background: var(--pi-surface); color: var(--pi-text); padding: 5px 7px; cursor: pointer; }
  button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .tab-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .tab-custom-icon { flex: 0 0 auto; width: 16px; height: 16px; display: inline-grid; place-items: center; color: currentColor; pointer-events: none; }
  .tab-custom-icon svg { width: 16px; height: 16px; pointer-events: none; }
  .tab-label { min-width: 0; }
  .tab-badge { flex: 0 0 auto; display: inline-block; min-width: 14px; border: 1px solid var(--pi-success-border); border-radius: 999px; background: var(--pi-success-surface); color: var(--pi-success); padding: 0 5px; font-size: 11px; line-height: 16px; text-align: center; }
  @container (max-width: 430px) {
    .tabs button.icon-tab { justify-content: center; padding-inline: 7px; }
    .tabs button.icon-tab .tab-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
  }
  .panel-content { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
  .empty-state { box-sizing: border-box; width: min(100%, 380px); margin: auto; padding: 24px; display: grid; gap: 8px; color: var(--pi-muted); text-align: center; }
  .empty-state h2 { margin: 0; color: var(--pi-text); font-size: 15px; line-height: 1.3; }
  .empty-state p { margin: 0; line-height: 1.45; }
  small, .muted { color: var(--pi-muted); }
  @media (max-width: 1180px) { header { display: none; } }
  .workspace-label { min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; max-width: 100%; overflow: hidden; white-space: nowrap; }
  .workspace-label-base, .workspace-label-item, .workspace-label-render { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .workspace-label-item, .workspace-label-render, .workspace-label-separator { color: var(--pi-muted); }
  .workspace-label-link { color: var(--pi-accent); text-decoration: none; }
  .workspace-label-link:hover, .workspace-label-link:focus { text-decoration: underline; }
  .toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid var(--pi-border-muted); }
  .toolbar button { margin-left: auto; }
  .stale { border: 1px solid var(--pi-warning-border); border-radius: 999px; color: var(--pi-warning); padding: 1px 6px; font-size: 12px; }
  .split { flex: 1 1 auto; min-height: 0; display: grid; grid-template-rows: minmax(160px, 34%) minmax(0, 1fr); }
  .list { min-height: 0; overflow: auto; border-bottom: 1px solid var(--pi-border); padding: 6px; }
  .row { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 4px; width: 100%; border: 0; border-radius: 5px; background: transparent; text-align: left; padding: 4px 6px 4px calc(6px + var(--depth, 0) * 14px); }
  .row:hover, .row.selected { background: var(--pi-selection-bg); }
  .row span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .summary { margin: 4px 6px 8px; color: var(--pi-muted); }
  .viewer { min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .diffs { flex: 1 1 auto; min-height: 0; overflow: auto; display: grid; grid-template-rows: minmax(120px, 1fr) minmax(120px, 1fr); }
  .diffs.single { grid-template-rows: minmax(0, 1fr); }
  .diff-section { min-height: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--pi-border); }
  .diff-section:last-child { border-bottom: 0; }
  .viewer-header { position: sticky; top: 0; display: flex; justify-content: space-between; gap: 8px; padding: 8px; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
  .viewer-header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  code-viewer, unified-diff-viewer { flex: 1 1 auto; min-height: 0; }
  .image-preview { flex: 1 1 auto; min-height: 0; box-sizing: border-box; display: flex; align-items: center; justify-content: center; overflow: auto; padding: 16px; }
  .image-preview img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid var(--pi-border-muted); border-radius: 8px; background-color: var(--pi-surface); background-image: linear-gradient(45deg, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 25%, transparent 25%), linear-gradient(-45deg, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 75%), linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; box-shadow: 0 8px 24px var(--pi-shadow-soft); }
  pre { margin: 0; padding: 10px; overflow: auto; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  p { margin: 10px; }
`;

export const listStyles = css`
  :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden; color: var(--pi-text); font: 14px system-ui, sans-serif; }
  :host([collapsed]) { flex: 0 0 auto; min-height: auto; overflow: hidden; }
  section { box-sizing: border-box; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 10px; }
  h2 { flex: 0 0 auto; display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 0 0 8px; color: var(--pi-muted); font-size: 12px; text-transform: uppercase; }
  .list-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
  button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  section > button { display: block; width: 100%; text-align: left; margin: 6px 0; }
  .subheading { margin-top: 14px; }
  .section-toggle { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; width: 100%; border: 0; background: transparent; color: inherit; padding: 0; font: inherit; text-align: left; text-transform: inherit; }
  .section-toggle span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .section-title { display: grid; gap: 2px; min-width: 0; }
  .section-toggle .section-selected { display: block; color: var(--pi-text); font-size: 12px; font-weight: 600; line-height: 1.25; text-transform: none; }
  .section-toggle .section-count { flex: 0 0 auto; display: inline; color: var(--pi-muted); font-size: inherit; }
  .section-toggle small { display: inline; color: inherit; font-size: inherit; }
  .action-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; margin: 6px 0; cursor: pointer; }
  .action-row:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; border-radius: 8px; }
  .action-row.selected .action-main, .action-row.selected .action-menu-toggle { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .action-row.archived .action-main { color: var(--pi-muted); }
  .action-main { position: relative; box-sizing: border-box; min-width: 0; width: 100%; border: 1px solid var(--pi-border); border-top-right-radius: 0; border-bottom-right-radius: 0; border-top-left-radius: 8px; border-bottom-left-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 22px 7px calc(9px + var(--depth, 0) * 16px); text-align: left; }
  .action-name { display: -webkit-box; max-height: 2.5em; overflow: hidden; overflow-wrap: anywhere; line-height: 1.25; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .action-row:not(.selected):hover .action-main { background: var(--pi-surface-hover); }
  .workspace-row .action-main { border-radius: 8px 0 0 8px; }
  .workspace-primary { min-width: 0; display: flex; align-items: baseline; gap: 6px; }
  .workspace-primary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-status { flex: 0 0 auto; color: var(--pi-warning); font-size: 12px; }
  .workspace-secondary { margin-top: 3px; }
  .workspace-menu-panel { width: max-content; min-width: min(120px, calc(100vw - 16px)); padding: 8px; }
  .workspace-menu-actions { margin: 0 0 8px; padding-bottom: 8px; border-bottom: 1px solid var(--pi-border-muted); }
  .workspace-menu-actions button.danger { color: var(--pi-danger); }
  .workspace-menu-actions button.danger:hover, .workspace-menu-actions button.danger:focus { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
  .workspace-menu-details { display: grid; gap: 6px; margin: 0; }
  .workspace-detail-row { display: grid; grid-template-columns: minmax(58px, max-content) minmax(0, 1fr); gap: 8px; align-items: baseline; }
  .workspace-detail-row dt { color: var(--pi-muted); font-size: 12px; white-space: normal; }
  .workspace-detail-row dd { min-width: 0; margin: 0; overflow-wrap: anywhere; white-space: normal; }
  .action-menu-panel .detail-copy { box-sizing: border-box; display: inline-grid; place-items: center; width: 18px; height: 18px; margin-left: 6px; padding: 0; border: 1px solid var(--pi-border); border-radius: 5px; background: transparent; color: var(--pi-muted); font-size: 11px; line-height: 1; cursor: pointer; vertical-align: middle; }
  .action-menu-panel .detail-copy:hover, .action-menu-panel .detail-copy:focus { color: var(--pi-text); border-color: var(--pi-accent); background: var(--pi-surface-hover); }
  .tree-marker { color: var(--pi-dim); margin-right: 5px; }
  .badge { display: inline-block; margin-left: 5px; border: 1px solid var(--pi-border); border-radius: 999px; color: var(--pi-muted); padding: 0 5px; font-size: 11px; font-weight: 400; }
  .action-activity { position: absolute; top: 5px; right: 6px; z-index: 1; display: grid; place-items: center; width: 10px; height: 10px; }
  .action-activity .activity-indicator { margin: 0; vertical-align: 0; }
  .activity-indicator { flex: 0 0 auto; display: inline-block; width: 7px; height: 7px; margin-right: 6px; background: var(--pi-success); animation: pulse 1s ease-in-out infinite; vertical-align: 1px; }
  .activity-indicator.session { border-radius: 50%; background: var(--pi-success); }
  .activity-indicator.terminal { border-radius: 2px; background: var(--pi-accent); }
  /* Client-side sending (upload in flight); distinct from server activity, which propagates to workspace/machine rows. */
  .activity-indicator.sending { border-radius: 50%; background: var(--pi-warning); }
  /* Unread is a stable state, not ongoing work: keep it static and accent-colored. */
  .activity-indicator.unread { border-radius: 50%; background: var(--pi-accent); animation: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--pi-accent) 20%, transparent); }
  /* Unread + ongoing work: a static accent ring wraps the still-pulsing work dot. */
  .unread-ring { flex: 0 0 auto; box-sizing: border-box; display: inline-grid; place-items: center; width: 9px; height: 9px; margin-right: 6px; border: 1.5px solid var(--pi-accent); border-radius: 50%; vertical-align: 1px; }
  .unread-ring .activity-indicator { width: 5px; height: 5px; margin: 0; vertical-align: 0; }
  .action-activity .unread-ring { margin: 0; vertical-align: 0; }
  .action-menu { position: relative; align-self: stretch; }
  .action-menu-toggle { display: grid; place-items: center; height: 100%; min-width: 32px; padding: 0; color: var(--pi-muted); border-left: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; }
  .action-menu-toggle:hover { color: var(--pi-text); background: var(--pi-surface-hover); }
  .action-menu-panel { position: fixed; z-index: 50; box-sizing: border-box; min-width: min(120px, calc(100vw - 16px)); overflow: auto; padding: 4px; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); box-shadow: 0 8px 24px var(--pi-shadow); overflow-wrap: anywhere; }
  .action-menu-panel button { display: block; width: 100%; text-align: left; white-space: normal; overflow-wrap: anywhere; border: 0; background: transparent; color: var(--pi-text); }
  .action-menu-panel button:hover { background: var(--pi-selection-bg); }
  button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  small { display: block; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-label { min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; max-width: 100%; overflow: hidden; white-space: nowrap; }
  .workspace-label-base, .workspace-label-item, .workspace-label-render { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .workspace-label-item, .workspace-label-render, .workspace-label-separator { color: var(--pi-muted); }
  .workspace-label-link { color: var(--pi-accent); text-decoration: none; }
  .workspace-label-link:hover, .workspace-label-link:focus { text-decoration: underline; }
  .workspace-detail-row .workspace-label { overflow: visible; white-space: normal; flex-wrap: wrap; }
  .workspace-detail-row .workspace-label-base, .workspace-detail-row .workspace-label-item, .workspace-detail-row .workspace-label-render { overflow: visible; text-overflow: clip; overflow-wrap: anywhere; white-space: normal; }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
`;

export const chatStyles = css`
  :host { position: relative; z-index: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; color: var(--pi-text); font: 14px system-ui, sans-serif; }
  /* Size container for the transcript. Lives on the wrapper rather than the
     scroller so containment cannot interact with sticky headers or scroll
     anchoring inside .chat. Resolves --calm-measure for the reading column from
     its inline size, and the reserved height of an opening turn from its block
     size. The wrapper is sized by the flex column above it, never by its own
     contents, so size containment costs it nothing. */
  .chat-wrap { container-type: size; position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .top-notices { box-sizing: border-box; flex: 0 0 auto; max-height: 40%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg-overlay); }
  .session-warnings { flex: 0 1 auto; display: grid; gap: 8px; max-height: 50%; min-height: 0; overflow-y: auto; box-sizing: border-box; padding: 10px 16px; border-bottom: 1px solid var(--pi-border-muted); }
  .session-warnings:only-child { flex: 1 1 auto; max-height: 100%; border-bottom: 0; }
  .session-warnings-controls { display: flex; justify-content: flex-end; }
  .session-warnings-collapse { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); padding: 4px 7px; font: 12px system-ui, sans-serif; cursor: pointer; }
  .session-warnings-collapse:hover, .session-warnings-collapse:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); background: var(--pi-bg-overlay); }
  .session-warnings-collapse:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
  .session-warnings-collapse-icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .session-warning { position: relative; display: grid; gap: 4px; box-sizing: border-box; padding: 10px 34px 10px 12px; border: 1px solid var(--pi-warning-border); border-radius: 10px; background: var(--pi-warning-surface); color: var(--pi-text); }
  .session-warning.error { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 12%, var(--pi-surface)); }
  .session-warning.info { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
  .session-warning-head { display: flex; align-items: center; gap: 8px; min-height: 16px; }
  .session-warning-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .session-warning-body { min-width: 0; display: grid; gap: 3px; }
  .session-warning-message { margin: 0; overflow-wrap: anywhere; }
  .session-warning-path { margin: 0; color: var(--pi-muted); font-size: 12px; font-family: var(--pi-mono, ui-monospace, monospace); overflow-wrap: anywhere; }
  .session-warning-source { color: var(--pi-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .session-warning-dismiss { position: absolute; top: 6px; right: 6px; display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); font: 15px/1 system-ui, sans-serif; cursor: pointer; }
  .session-warning-dismiss:hover, .session-warning-dismiss:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); background: var(--pi-bg-overlay); }
  .session-warning-dismiss:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
  .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important; }
  .notification-live span { display: block; }
  /* Reading column. A centred single-track grid rather than per-child
     max-width plus auto margins: several transcript children declare margin
     shorthands later in this sheet, which would silently reset margin-inline
     and left-align the column. The track owns the width, so child rules cannot
     fight it. */
  /* How far content wider than prose may reach past the reading column.

     Prose is capped for reading, but a table or a code block is not prose: it
     was being clipped and made to scroll sideways while empty space sat
     immediately beside it. This is exactly the free space either side of the
     centred column, so wide content can use it and never more, and it is capped
     so a wide monitor does not stretch a table to the horizon. */
  .chat { --calm-bleed: min(max(0px, (100cqi - 32px - var(--calm-measure)) / 2), 10rem); --pi-chat-sticky-top: -26px; --pi-chat-pad-block-start: 26px; --pi-chat-pad-block-end: 16px; display: grid; grid-template-columns: minmax(0, var(--calm-measure)); justify-content: center; height: 100%; min-height: 0; overflow: auto; overflow-anchor: none; padding: var(--pi-chat-pad-block-start) 16px var(--pi-chat-pad-block-end); box-sizing: border-box; }
  /* One human message and its reply share a box. The box is what the reading
     position holds at the top of the viewport when a turn opens, and what
     reserves the space a streaming reply arrives into. It adds no spacing of
     its own: the turn gap still comes from the human message inside it. */
  .turn { min-width: 0; display: block; }
  /* An opening turn reserves a screenful so its first line can sit at the top
     of the viewport with the reply arriving underneath it, instead of the reply
     pushing the question up the screen as it streams. The reservation belongs to
     the turn rather than to a trailing spacer, so it disappears exactly as the
     turn's own content grows to fill the screen and leaves no dead space behind
     a long answer.

     It sits on an inner block rather than on the turn itself. The turn is a grid
     item, and a grid row sized from its item's own minimum stops tracking that
     item's content: a long reply then overflowed its row and drew on top of the
     liveness line below it. A block box inside the item has no such trouble, and
     the turn goes back to being sized by what it holds.

     Only the end padding comes off the screenful. The turn has to be able to
     scroll past the scroller's start padding to reach the top edge, so that
     padding is height the reservation must supply rather than height it can
     assume is already there. */
  .turn-body { min-width: 0; }
  .turn-body.reserved { min-block-size: calc(100cqb - var(--pi-chat-pad-block-end)); }
  .scroll-marker { display: block; height: 0; overflow: hidden; pointer-events: none; }
  /* Transcript messages carry no card. Roles are told apart by weight and
     tone, not by a border and fill per role: colour is reserved for things
     that need attention, and a colour per role spends it on everything. */
  /* Paragraph rhythm by default; the wide gap is added back only at a turn
     boundary below. Spacing keys on what an element is rather than what follows
     it, because a zero-height scroll marker sits between every pair of messages
     and defeats sibling adjacency. */
  /* Full ink. Tone no longer separates prose from prose -- it only separates
     language from machinery, which is the job it can actually do. Muting the
     reply was the worst of it: the reply is the thing being read, and it was
     the thing rendered faint. */
  .msg { max-width: 100%; min-width: 0; box-sizing: border-box; margin: 0 0 var(--calm-para-gap); padding: 0; border: 0; border-radius: 0; background: none; color: var(--calm-ink); overflow: visible; }
  /* A turn starts when the human speaks. That is the only break the eye needs
     to find without reading. */
  .msg.user, .msg.bash { margin-top: calc(var(--calm-turn-gap) - var(--calm-para-gap)); }
  /* The question is told apart by where it sits and by carrying a container,
     not by how it is coloured. Weight and tone were the previous cue and both
     failed the skim test: you had to read a line to learn who wrote it.

     The bubble shrink-wraps and is pushed to the far side by an auto margin,
     so a short question is a small shape and a long one still reads normally:
     the words inside stay left-aligned. Right-aligning the text itself gives
     English a ragged left edge, which costs real reading effort.

     The hairline is not decoration. In the light theme the surface sits only
     eight values above the canvas, which is too little to read as a container
     on its own. */
  /* Prose runs a size larger than the interface around it, because it is the
     thing being read rather than operated. */
  .msg.user, .msg.assistant { font-size: 15px; }
  .msg.user {
    /* A bubble is a container, not a page: content inside it stays inside it. */
    --calm-bleed: 0px;
    width: fit-content;
    max-width: min(100%, 30rem);
    margin-inline-start: auto;
    border: 1px solid var(--calm-rule);
    border-radius: 14px;
    background: var(--calm-canvas-soft);
    padding: 12px 16px;
  }
  .msg.tool, .msg.bash, .msg.skill { color: var(--calm-ink-dim); }
  .msg.tool-execution-shell, .msg.ask-user-record-shell { padding: 0; border: 0; background: transparent; color: var(--calm-ink-muted); }
  .msg.ask-user-record-shell ask-user-card { margin: 0 auto; }
  .msg.system { color: var(--calm-ink-muted); }
  /* The activity fold. A quiet line when closed; hairline blocks when open.
     No fills or radii inside: a fold must not reintroduce the card texture the
     transcript drops. */
  .msg.event-group { padding: 0; border: 0; background: none; color: var(--calm-ink-dim); }
  .msg.event-group > summary { display: flex; align-items: baseline; gap: 8px; padding: 0; border: 0; background: none; color: var(--calm-ink-dim); font-size: 13px; list-style: none; cursor: pointer; }
  .msg.event-group > summary::-webkit-details-marker { display: none; }
  .msg.event-group > summary::before { content: "▸"; color: var(--calm-ink-dim); font-size: 11px; }
  .msg.event-group[open] > summary::before { content: "▾"; }
  .msg.event-group > summary:hover, .msg.event-group > summary:focus-visible { color: var(--calm-ink-muted); }
  .msg.event-group > summary .label { margin: 0; }
  /* The turn's time and model sit opposite its step count: one quiet line
     closing the turn, rather than a row repeated above every paragraph.

     Stays readable text on touch. Elsewhere a metadata row collapses to an
     information glyph on a device that cannot hover, because it would otherwise
     sit visible above every message forever -- but this row appears once per
     turn and is meant to be read without asking for it. */
  .msg.event-group > summary .msg-meta { margin-inline-start: auto; opacity: 1; color: var(--calm-ink-dim); }
  .msg.event-group > summary .msg-meta:not(.expanded) { display: inline; width: auto; max-width: none; height: auto; font-size: 11px; text-overflow: ellipsis; }
  .msg.event-group > summary .msg-meta::before { content: none; }
  .msg.event-group > summary .msg-meta.expanded { flex: 0 1 auto; }
  .group-body { display: grid; gap: 18px; margin-top: 14px; padding: 0; }
  .chat-image { display: block; max-width: 100%; max-height: 320px; margin: 8px 0 0; border: 1px solid var(--pi-border-muted); border-radius: 8px; object-fit: contain; cursor: zoom-in; }
  .chat-image:focus-visible { outline: 2px solid var(--pi-accent, var(--pi-success-border)); outline-offset: 2px; }
  dialog.image-zoom { position: fixed; inset: 0; margin: auto; max-width: calc(96vw - env(safe-area-inset-left) - env(safe-area-inset-right)); max-height: calc(96vh - env(safe-area-inset-top) - env(safe-area-inset-bottom)); width: fit-content; height: fit-content; padding: 0; border: none; background: transparent; overflow: visible; }
  dialog.image-zoom[open] { display: flex; }
  dialog.image-zoom::backdrop { background: rgba(0, 0, 0, 0.8); }
  .image-zoom-full { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: 8px; object-fit: contain; cursor: zoom-out; }
  .image-zoom-close { position: absolute; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; font: 16px/1 system-ui, sans-serif; color: var(--pi-muted); background: color-mix(in srgb, var(--pi-surface) 88%, transparent); border: 1px solid var(--pi-border); border-radius: 6px; cursor: pointer; }
  .image-zoom-close:hover, .image-zoom-close:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); }
  .image-zoom-close:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
  .group-msg { max-width: 100%; min-width: 0; box-sizing: border-box; padding: 0 0 0 12px; border-top: 0; border-left: 1px solid var(--calm-rule); color: var(--calm-ink-dim); overflow: visible; }
  .group-msg.tool, .group-msg.tool-execution-shell, .group-msg.bash { color: var(--calm-ink-dim); }
  .group-msg.system { color: var(--calm-ink-muted); }
  .history-boundary { position: relative; z-index: 5; display: grid; gap: 3px; justify-items: center; margin: 0 0 14px; color: var(--pi-muted); font-size: 12px; text-align: center; }
  .history-load-button { border: 1px solid var(--pi-border); border-radius: 999px; background: var(--pi-surface); color: var(--pi-text-secondary); padding: 5px 12px; font: 12px system-ui, sans-serif; cursor: pointer; }
  .history-load-button:hover, .history-load-button:focus { border-color: var(--pi-accent); color: var(--pi-text-bright); }
  .history-load-button:disabled { cursor: default; opacity: .55; }
  /* The failure signal, then the reason. Only the lead takes the danger tone;
     a fully coloured line reads as the system shouting. */
  .system-notice { margin: 0; color: var(--calm-ink-muted); }
  .system-notice-lead { color: var(--calm-danger); font-weight: 500; }
  .queued-messages { max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: 8px; margin: 0 0 var(--calm-turn-gap); padding: 0; border: 0; border-radius: 0; background: none; color: var(--calm-ink-dim); overflow: hidden; }
  .queued-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .queued-heading { min-width: 0; flex: 1 1 180px; display: grid; gap: 2px; }
  .queued-heading strong { color: var(--calm-ink-muted); font-weight: 500; }
  .queued-heading small { color: var(--calm-ink-dim); }
  .queued-clear-button { flex: 0 0 auto; border: 1px solid var(--pi-warning-border); border-radius: 999px; background: var(--pi-surface); color: var(--pi-warning); padding: 5px 10px; font: 12px system-ui, sans-serif; white-space: nowrap; cursor: pointer; }
  .queued-clear-button:hover, .queued-clear-button:focus { border-color: var(--pi-warning); color: var(--pi-text-bright); }
  .queued-message { display: grid; gap: 4px; padding-top: 8px; border-top: 1px solid var(--pi-border); }
  .queued-message:first-of-type { padding-top: 0; border-top: 0; }
  .queued-kind { color: var(--pi-muted); font-size: 12px; text-transform: uppercase; }
  .queued-dialogs { margin: -8px 0 14px; padding: 0 4px; color: var(--pi-muted); font-size: 12px; text-align: center; }
  .session-activity { max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: 4px; margin: 0 0 var(--calm-turn-gap); padding: 0; border: 0; border-radius: 0; background: none; color: var(--calm-ink-dim); overflow: hidden; }
  .session-activity strong { color: var(--calm-ink-muted); font-weight: 500; }
  .session-activity span, .session-activity small { color: var(--calm-ink-dim); }
  .history-boundary small { color: var(--pi-dim); }
  /* The liveness line is the running turn's footer, so it sits with the pooled
     activity above it rather than floating between them. */
  transcript-liveness { display: block; margin: -6px 0 var(--calm-turn-gap); }
  /* A turn's pooled activity closes that turn, so it sits tight under the prose
     it belongs to and keeps the full gap below to open the next turn. While the
     turn runs, the liveness line joins it as one footer. */

  /* No sticky header band. The row survives only to host the copy action and
     the message id, both of which stay hidden until hover or focus. Kept in
     flow rather than absolutely positioned: on touch the actions are always
     visible (see the hover: none block below), and an overlay would sit on top
     of the first line of every message. */
  .msg-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 18px; margin-bottom: 2px; }
  /* On the two roles whose label is hidden the row holds nothing but hover
     affordances, so it collapses to zero height and lets them render into the
     turn gap above the message instead of reserving a band of their own. */
  .msg.user > .msg-header, .msg.assistant > .msg-header { height: 0; min-height: 0; margin: 0; overflow: visible; }
  .msg.user > .msg-header > *, .msg.assistant > .msg-header > * { transform: translateY(-50%); }
  /* Weight and position identify the speaker, so the role label is noise on
     the two roles that dominate the transcript. It is kept everywhere else,
     where it names something the reader cannot infer. */
  .msg.user > .msg-header .label, .msg.assistant > .msg-header .label { display: none; }
  .msg.tool > .msg-header .label, .msg.bash > .msg-header .label, .msg.skill > .msg-header .label, .msg.system > .msg-header .label, .msg.tool-image-output > .msg-header .label, .group-msg > .msg-header .label { color: var(--calm-ink-dim); }
  .msg-header-trailing { min-width: 0; flex: 1 1 auto; display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .msg-actions { flex: 0 0 auto; display: inline-flex; gap: 6px; opacity: 0; transition: opacity .12s ease; }
  .msg-action { display: inline-grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 6px; background: none; color: var(--calm-ink-dim); padding: 0; font: 14px system-ui, sans-serif; line-height: 1; cursor: pointer; }
  .msg-action:hover, .msg-action:focus { color: var(--calm-ink); }
  .msg:hover > .msg-header .msg-actions, .msg:focus-within > .msg-header .msg-actions, .group-msg:hover > .msg-header .msg-actions, .group-msg:focus-within > .msg-header .msg-actions { opacity: 1; }
  .label { display: block; color: var(--calm-ink-dim); font-size: 11.5px; letter-spacing: .09em; text-transform: uppercase; }
  .msg-header .label { margin: 0; }
  .msg-meta { min-width: 0; opacity: .28; border: 0; background: transparent; color: var(--pi-dim); padding: 0; font: 11px system-ui, sans-serif; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity .12s ease; cursor: pointer; user-select: text; -webkit-user-select: text; }
  .msg:hover > .msg-header .msg-meta, .msg:focus-within > .msg-header .msg-meta, .group-msg:hover > .msg-header .msg-meta, .group-msg:focus-within > .msg-header .msg-meta, .msg-meta:focus, .msg-meta.expanded { opacity: 1; }
  .msg-meta.expanded { flex: 1 1 auto; max-width: 100%; white-space: normal; overflow: visible; overflow-wrap: anywhere; text-overflow: clip; }
  .msg-meta:focus { outline: 1px solid var(--pi-border); outline-offset: 3px; border-radius: 4px; }
  @media (hover: none) {
    .msg-actions { opacity: 1; }
    .msg-meta { opacity: .75; max-width: 26px; }
    .msg-meta:not(.expanded) { display: inline-grid; width: 26px; height: 22px; place-items: center; font-size: 0; text-overflow: clip; }
    .msg-meta::before { content: "ⓘ"; font-size: 13px; }
    .msg-meta.expanded { opacity: 1; max-width: 100%; }
    .msg-meta.expanded::before { content: ""; }
  }
  formatted-text.part { display: block; }
  formatted-text.part, .queued-message formatted-text { text-align: start; unicode-bidi: plaintext; }
  .part { max-width: 100%; min-width: 0; box-sizing: border-box; overflow: visible; }
  .part + .part { margin-top: 10px; }
  .tool-line { color: var(--pi-warning); }
  .summary { color: var(--pi-muted); margin-left: 6px; }
  .part:is(details) { border-top: 1px solid var(--pi-border); padding-top: 8px; }
  .part > formatted-text { display: block; max-width: 100%; min-width: 0; overflow: visible; }
  .skill-invocation, .skill-read { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); padding: 8px 10px; }
  .skill-invocation > summary, .skill-read > strong { color: var(--pi-purple); }
  .skill-invocation > small, .skill-read > small { display: block; margin: 6px 0 0; color: var(--pi-muted); }
  summary { cursor: pointer; color: var(--pi-muted); }
  pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; direction: ltr; text-align: left; unicode-bidi: isolate; }
  /* Shell output keeps monospace because it carries meaning, and a hairline
     instead of the success-coloured card it used to sit in. */
  .shell-output { padding-left: 12px; border-left: 1px solid var(--calm-rule); color: var(--calm-ink-dim); font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; direction: ltr; text-align: left; unicode-bidi: isolate; }
  .process-notification { padding: 8px 10px; border: 1px solid var(--pi-border-muted); border-radius: 8px; background: var(--pi-surface); }
  .process-notification.success { border-color: var(--pi-success-border); background: var(--pi-success-bg); }
  .process-notification.error { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-surface)); }
  .process-notification-header { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; line-height: 1.4; }
  .process-notification-header .status-affordance { flex: 0 0 auto; font-size: 15px; }
  .process-notification-header strong { flex: 0 0 auto; font-weight: 600; }
  .process-notification-header .summary { flex: 1 1 auto; min-width: 0; color: var(--pi-text); font-weight: normal; overflow-wrap: anywhere; }
  .process-notification-header .exit-code { flex: 0 0 auto; margin-left: auto; color: var(--pi-muted); font-size: 12px; font-family: var(--pi-mono, ui-monospace, monospace); }
  .process-notification .raw-disclosure { margin-top: 8px; border-top: 1px solid var(--pi-border-muted); padding-top: 6px; }
  .process-notification .raw-disclosure summary { cursor: pointer; color: var(--pi-muted); font-size: 12px; }
  .process-notification .raw-content { margin: 6px 0 0; padding: 8px; max-height: 180px; overflow: auto; border: 1px solid var(--pi-border-muted); border-radius: 6px; background: var(--pi-bg); color: var(--pi-text); font: 11px var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
`;

/** The liveness line at the foot of a running turn. */
export const transcriptLivenessStyles = css`
  :host { display: block; }
  .liveness { display: flex; align-items: baseline; gap: 8px; min-width: 0; margin: 0; color: var(--calm-ink-dim); font-size: 13px; }
  /* One line, always. A step is a glance; the fold holds the full text. */
  .liveness span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .liveness-dot { flex: 0 0 auto; align-self: center; width: 7px; height: 7px; border-radius: 50%; background: var(--pi-accent); }
  @media (prefers-reduced-motion: no-preference) {
    .liveness-dot { animation: transcript-liveness-pulse 1.8s ease-in-out infinite; }
  }
  @keyframes transcript-liveness-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
`;

export const formattedTextStyles = css`
  :host { display: block; }
  .formatted { white-space: normal; overflow-wrap: anywhere; line-height: 1.55; text-align: start; unicode-bidi: plaintext; }
  p, ul, ol, pre, blockquote, .table-scroll, .code-block-wrapper { margin: 0 0 10px; }
  :is(p, ul, ol, pre, blockquote, .table-scroll, .code-block-wrapper):last-child { margin-bottom: 0; }
  ul, ol { padding-left: 22px; }
  li + li { margin-top: 3px; }
  code { border: 1px solid var(--pi-border); border-radius: 4px; background: var(--pi-bg); padding: 1px 4px; font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; direction: ltr; text-align: left; unicode-bidi: isolate; }
  .code-block-wrapper { position: relative; }
  .code-block-wrapper pre { margin: 0; padding-right: 40px; }
  pre { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); padding: 10px; overflow-x: auto; overflow-y: hidden; direction: ltr; text-align: left; unicode-bidi: isolate; }
  pre code { border: 0; padding: 0; background: transparent; }
  .code-copy-button { position: absolute; top: 6px; right: 6px; z-index: 1; display: inline-grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); padding: 0; font: 14px system-ui, sans-serif; line-height: 1; cursor: pointer; }
  .code-copy-button:hover, .code-copy-button:focus { color: var(--pi-text); border-color: var(--pi-accent); }
  /* Content that is not prose may use the space beside the reading column.
     Only a standalone pre bleeds: one inside a code-block wrapper would widen
     twice, once for each box.

     Declared after the margin shorthands above. A later margin shorthand resets
     margin-inline to zero, so a bleed written before it silently does nothing --
     which is exactly what happened the first time. The same trap caught the
     width: a later max-width of 100% on .table-scroll left the negative margins
     in force with no room to expand into, so a table slid sideways out of the
     column instead of widening, and scrolled horizontally with empty space
     beside it. Nothing below may cap the width of these three. */
  .table-scroll, .code-block-wrapper, .formatted > pre { max-width: calc(100% + 2 * var(--calm-bleed, 0px)); margin-inline: calc(-1 * var(--calm-bleed, 0px)); }
  blockquote { border-left: 3px solid var(--pi-border); padding-left: 10px; color: var(--pi-muted); }
  a { color: var(--pi-accent); }
  /* A heading belongs to what follows it, so it sits far from the paragraph
     above and close to the one below. Equal space on both sides leaves it
     floating between two blocks and belonging to neither. Close, but not
     touching: at 6px the heading crowded its own first line. */
  h1, h2, h3, h4 { margin: 28px 0 10px; line-height: 1.25; }
  h1:first-child, h2:first-child, h3:first-child, h4:first-child { margin-top: 0; }
  h1 { font-size: 20px; }
  h2 { font-size: 17px; }
  h3 { font-size: 15px; }
  h4 { font-size: 14px; }
  .table-scroll { overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
  .table-scroll:focus-visible { outline: 1px solid var(--pi-accent); outline-offset: 2px; }
  table { border-collapse: collapse; width: max-content; min-width: 100%; max-width: none; }
  th, td { border: 1px solid var(--pi-border); padding: 4px 8px; max-width: 48ch; overflow-wrap: anywhere; }
  th { background: var(--pi-surface); }
`;

export const autocompleteStyles = css`
  :host { display: block; }
  .menu { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); z-index: 10; max-height: 260px; overflow: auto; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); box-shadow: 0 10px 30px var(--pi-shadow); }
  button { display: grid; grid-template-columns: minmax(120px, 1fr) auto; gap: 4px 10px; width: 100%; border: 0; border-bottom: 1px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-text); padding: 8px 10px; text-align: left; cursor: pointer; }
  button:last-child { border-bottom: 0; }
  button.selected, button:hover { background: var(--pi-selection-bg); }
  span { color: var(--pi-muted); font-size: 12px; }
  small { grid-column: 1 / -1; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

export const promptEditorStyles = css`
  /*
   * The composer is one island: an inset surface the transcript runs up to,
   * rather than a stack of full-width bands. Everything it needs — the context
   * reading, the draft, one control rail — lives inside that single border, so
   * a new capability has to earn its place on the rail instead of adding a row.
   * It is its own container: nothing here keys off the viewport.
   */
  :host { position: relative; z-index: 5; display: block; container-type: inline-size; color: var(--pi-text); font: 14px system-ui, sans-serif; }
  footer {
    position: relative;
    display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px;
    margin: 0 clamp(6px, 2cqi, 12px) max(8px, env(safe-area-inset-bottom));
    padding: 10px;
    overflow: hidden;
    border: 1px solid var(--pi-border);
    border-radius: 16px;
    background: var(--pi-bg);
    box-shadow: 0 6px 18px var(--pi-shadow);
  }
  /* Context use is the island's own top edge — one reading on a line the eye
     already crosses, instead of a band of its own. */
  context-usage-meter { position: absolute; top: 0; right: 0; left: 0; }
  footer.shell-mode { border-color: var(--pi-success); background: var(--pi-success-bg); }
  .editor-wrap { position: relative; min-width: 0; }
  .actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: nowrap; white-space: nowrap; }
  .compact-status { display: flex; min-width: 0; align-items: center; gap: 6px; color: var(--pi-muted); font-size: 12px; flex: 1 1 0; }
  .compact-status > button { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .model-capsule { flex: 0 1 auto; display: inline-flex; align-items: center; min-width: 0; }
  .model-capsule .select-model { max-width: min(42cqi, 320px); border-start-end-radius: 0; border-end-end-radius: 0; }
  .model-capsule .select-thinking { width: auto; min-width: 34px; margin-inline-start: -1px; padding-inline: 6px; border-start-start-radius: 0; border-end-start-radius: 0; }
  /* The gauge carries the level; the word joins it only where the rail has room. */
  .thinking-level { display: none; margin-inline-start: 4px; font-size: 11.5px; }
  @container (min-width: 560px) {
    .thinking-level { display: inline; }
  }
  /* Identity, archive, and the summon control only appear once the chrome bands are gone. */
  .session-identity { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--pi-text-secondary); }
  .composer-archive { flex: 0 0 auto; white-space: nowrap; border-color: var(--pi-border-muted); color: var(--pi-muted); padding: 5px 9px; font-size: inherit; }
  .composer-archive:hover, .composer-archive:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); }
  .composer-summon { flex: 0 0 auto; }
  .icon-button { flex: 0 0 auto; display: inline-grid; place-items: center; width: 36px; height: 36px; padding: 0; }
  /* Queue and steer read as one control with two targets: steering is a way of
     answering the running turn, not a separate errand. */
  .primary-action { flex: 0 0 auto; display: inline-flex; align-items: center; }
  .primary-action:has(.steer-button) .send-button { border-start-end-radius: 0; border-end-end-radius: 0; }
  .primary-action .steer-button { margin-inline-start: -1px; border-start-start-radius: 0; border-end-start-radius: 0; }
  .icon-button .prompt-action-icon, .icon-button .prompt-thinking-gauge { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .icon-button .prompt-action-icon-filled { fill: currentColor; stroke: none; }
  .send-button:not(:disabled) { color: var(--pi-accent, var(--pi-text)); }
  .stop-button:not(:disabled) { color: var(--pi-danger); }
  .select-thinking .prompt-thinking-gauge .gauge-bar { fill: currentColor; stroke: none; opacity: .28; }
  .select-thinking .prompt-thinking-gauge .gauge-bar-active { opacity: 1; }
  /* One way in to everything the rail does not hold, and the only place a
     waiting warning or notification can announce itself now the bar is gone. */
  .island-menu { position: relative; }
  .island-menu.attention { border-color: var(--pi-accent); color: var(--pi-accent); }
  .island-menu-count {
    position: absolute; top: -3px; right: -3px; min-width: 15px; height: 15px; padding: 0 3px;
    border-radius: 999px; background: var(--pi-accent); color: var(--pi-bg);
    font: 600 10px/15px system-ui, sans-serif; text-align: center;
  }
  textarea, .markdown-editor .cm-editor { box-sizing: border-box; width: 100%; min-height: 54px; max-height: 220px; resize: none; overflow: hidden; border-radius: 8px; border: 1px solid var(--pi-border); background: var(--pi-bg); color: var(--pi-text); font: var(--pi-control-font-size, 16px)/1.4 var(--pi-control-font-family, system-ui, sans-serif); }
  textarea { overflow-y: auto; padding: 8px; }
  .markdown-editor .cm-scroller { max-height: 220px; overflow-y: auto; font-family: var(--pi-control-font-family, system-ui, sans-serif); line-height: 1.4; }
  .markdown-editor .cm-content { min-height: 38px; padding: 8px; caret-color: var(--pi-text); text-align: start; unicode-bidi: plaintext; }
  .markdown-editor .cm-line { padding: 0; unicode-bidi: plaintext; }
  .markdown-editor .cm-placeholder { color: var(--pi-dim); }
  .markdown-editor .cm-focused { outline: none; }
  .shell-mode textarea, .shell-mode .markdown-editor .cm-editor { border-color: var(--pi-success); box-shadow: 0 0 0 1px var(--pi-success-ring); }
  /*
   * At rest the composer stands down to a single line so the transcript keeps
   * the space. Focus, typed text, or an attachment restores it; the model and
   * thinking controls come back with it rather than being lost.
   */
  .resting { gap: 6px; padding-block: 7px; }
  .resting .markdown-editor .cm-editor { min-height: 38px; }
  .resting .markdown-editor .cm-content { min-height: 22px; padding-block: 6px; }

  .resting .model-capsule { display: none; }
  .mode-hint { position: absolute; right: 8px; bottom: 8px; max-width: calc(100% - 54px); border: 1px solid var(--pi-success-border); border-radius: 999px; background: var(--pi-success-surface); color: var(--pi-success); padding: 2px 8px; font-size: 12px; pointer-events: none; }
  .attachments { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
  .attachment-chip { position: relative; width: 56px; height: 56px; border: 1px solid var(--pi-border); border-radius: 8px; overflow: hidden; background: var(--pi-bg); }
  .attachment-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .attachment-chip-file { display: grid; place-items: center; }
  .attachment-file-preview { display: grid; place-items: center; width: 34px; height: 26px; border: 1px solid var(--pi-border-muted); border-radius: 4px; background: var(--pi-surface); color: var(--pi-muted); font: 700 10px/1 system-ui, sans-serif; letter-spacing: .03em; }
  .attachment-file-name { position: absolute; right: 4px; bottom: 3px; left: 4px; overflow: hidden; color: var(--pi-muted); font-size: 10px; line-height: 1.2; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
  .attachment-remove { position: absolute; top: 1px; right: 1px; width: 18px; height: 18px; padding: 0; line-height: 16px; border-radius: 50%; border: 1px solid var(--pi-border); background: var(--pi-surface); color: var(--pi-text); font-size: 13px; cursor: pointer; }
  .attachment-delivery select { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 5px 7px; font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
  .attachment-error { flex-basis: 100%; color: var(--pi-danger); font-size: 12px; }
  button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  button:disabled, textarea:disabled, .markdown-editor-disabled .cm-editor { opacity: .5; cursor: not-allowed; }
  @container (max-width: 640px) {
    footer { gap: 8px; padding: 8px; }
    .actions { gap: 6px; }
    .compact-status { flex: 1 1 220px; gap: 4px; }
    .select-model { max-width: min(58cqi, 260px); }
    button { padding: 6px 8px; }
  }
  @container (max-width: 430px) {
    .compact-status { flex-basis: 170px; font-size: 11px; }
    .select-model { max-width: 48cqi; }
    button { padding: 5px 7px; }
  }
`;

/**
 * The control sheet the composer summons once the chat surface stops keeping
 * its chrome resident. It rises from the bottom because that is where it was
 * asked for, and it overlays rather than displaces so dismissing it returns the
 * conversation untouched.
 */
export const controlSheetStyles = css`
  /*
   * Closed, the host takes no box at all. Open, it claims the whole pane and its
   * own stacking context: display:contents would drop the box and take the
   * z-index with it, letting the composer paint over the sheet.
   */
  :host { display: none; }
  :host([open]) { position: absolute; inset: 0; z-index: 40; display: block; }
  .control-sheet-scrim { position: absolute; inset: 0; z-index: 0; display: block; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 0; background: var(--pi-shadow); cursor: pointer; }
  .control-sheet {
    position: absolute; left: 0; right: 0; bottom: 0; z-index: 1;
    display: flex; flex-direction: column; gap: 2px;
    max-height: 80%; overflow-y: auto;
    padding: 7px 0 max(9px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--pi-border);
    border-radius: 12px 12px 0 0;
    background: var(--pi-bg);
    box-shadow: 0 -10px 24px var(--pi-shadow-strong);
  }
  @media (prefers-reduced-motion: no-preference) {
    .control-sheet { animation: control-sheet-in 160ms ease-out; }
  }
  @keyframes control-sheet-in { from { transform: translateY(100%); } to { transform: translateY(0); } }
  .control-sheet-grab { align-self: center; width: 34px; height: 4px; margin-bottom: 5px; border-radius: 2px; background: var(--pi-border); }
  .control-sheet-notifications { margin: 0; padding: 9px 12px 2px; color: var(--pi-muted); font-size: 12px; }
  /* Three named groups — do this, know this, go there — so the sheet does not
     read as one list once it carries the retired status readings. */
  .control-sheet-section { margin: 0; padding: 9px 12px 2px; color: var(--pi-dim); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
  .control-sheet-action { display: flex; align-items: center; gap: 7px; width: 100%; border: 0; border-radius: 0; background: transparent; color: var(--pi-text); padding: 9px 12px; font: inherit; text-align: start; cursor: pointer; }
  .control-sheet-action:hover, .control-sheet-action:focus-visible { background: var(--pi-selection-bg); }
  .control-sheet-warning-icon { flex: 0 0 auto; width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .control-sheet-readings { display: flex; flex-wrap: wrap; gap: 12px; padding: 2px 12px 4px; color: var(--pi-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .control-sheet-note { margin: 0; padding: 6px 12px; color: var(--pi-dim); font-size: 12px; }
`;
