import { css, svg, type TemplateResult } from "lit";
import type { AskUserOutcome, ProcessNotificationDetails } from "../../../shared/apiTypes";
import type { PromptResourceCommandIdentity } from "../../../shared/promptResourceCommand";
import type { SessionWarningSeverity } from "../api";
import type { ChatLineTranscriptPosition } from "../chatLinePosition";

export const NEW_SESSION_LABEL = "New session";

export function renderNewSessionIcon(): TemplateResult {
  return svg`
    <svg class="new-session-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 2.5v11M2.5 8h11"></path>
    </svg>
  `;
}

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
  /** Stable source location for history-backed lines. Kept non-enumerable by normalization. */
  transcriptPosition?: ChatLineTranscriptPosition;
  /** Original user prompt when normalization splits one prompt into several visible lines. */
  promptText?: string;
  /** A temporary client projection that a later final event must replace. */
  projection?: "optimistic";
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
  promptResourceCommandIdentity?: PromptResourceCommandIdentity;
}

export const appStyles = css`
  /* Mobile browsers already subtract browser controls from 100dvh; reserve bottom safe area only in standalone PWA modes. */
  :host { --pi-app-safe-area-bottom: 0px; position: fixed; top: 0; right: 0; left: 0; display: block; height: var(--pi-viewport-height, 100dvh); box-sizing: border-box; overflow: hidden; padding: env(safe-area-inset-top) env(safe-area-inset-right) var(--pi-app-safe-area-bottom) env(safe-area-inset-left); color: var(--pi-text); background: var(--pi-bg); font: var(--pi-text-md) system-ui, sans-serif; }
  :host([pwa-display-mode]) { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  @media (display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui) {
    :host { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  }
  /*
   * A peeked sheet is placed against the shell's own box, so the shell is the
   * containing block. Everything else in here is grid placement.
   */
  /*
   * The host takes the space actually on screen. The shell fills its content
   * box so safe-area padding remains inside that measured height instead of
   * pushing the shell's bottom past the viewport clip.
   */
  .shell { height: 100%; position: relative; --navigation-panel-size: 340px; --workspace-panel-size: minmax(360px, 42vw); --navigation-panel-width: var(--navigation-panel-size); --workspace-panel-width: var(--workspace-panel-size); display: grid; grid-template-columns: var(--navigation-panel-width) 1px minmax(320px, 1fr) 1px var(--workspace-panel-width); min-height: 0; }
  /*
   * One surface, two presentations. Docked it is a grid track; peeked it is
   * lifted out of flow at the same width, so pinning changes what holds the
   * panel up without moving the panel.
   */
  .panel-surface { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
  .panel-surface[hidden] { display: none; }
  .panel-surface[data-side="navigation"] { grid-column: 1; }
  .panel-surface[data-side="workspace"] { grid-column: 5; }
  .panel-surface > * { flex: 1 1 auto; min-height: 0; }
  .panel-surface[data-mode="sheet"] { position: absolute; inset-block: 0; z-index: 41; background: var(--pi-bg); box-shadow: 0 0 24px var(--pi-shadow); transition: transform var(--pi-motion-move) ease; }
  /* While a finger is down: no easing, so the sheet cannot lag the hand. */
  .panel-surface[data-mode="sheet"][data-tracking] { transition: none; will-change: transform; }
  /*
   * A grip on the edge that faces the session, so the sheet says it can be
   * pushed. It is drawn rather than added as an element: nothing about it is
   * interactive on its own, and the whole sheet already answers a drag.
   */
  .panel-surface[data-mode="sheet"]::after {
    content: "";
    position: absolute;
    inset-block: 0;
    width: 18px;
    background: no-repeat center / 4px 44px linear-gradient(var(--pi-border), var(--pi-border));
    border-radius: var(--pi-radius-pill);
    opacity: .55;
    pointer-events: none;
  }
  .panel-surface[data-mode="sheet"][data-side="navigation"]::after { inset-inline-end: 0; }
  .panel-surface[data-mode="sheet"][data-side="workspace"]::after { inset-inline-start: 0; }
  /*
   * Only the edge facing the session is rounded. The outer edge is flush with
   * the screen, and rounding it would show the transcript through the corners.
   * The radius is a literal because the theme contract carries colour only.
   */
  .panel-surface[data-mode="sheet"][data-side="navigation"] { inset-inline-start: 0; transform: translateX(calc((var(--peek-progress, 0) - 1) * 100%)); border-start-end-radius: 16px; border-end-end-radius: 16px; }
  .panel-surface[data-mode="sheet"][data-side="workspace"] { inset-inline-end: 0; transform: translateX(calc((1 - var(--peek-progress, 0)) * 100%)); border-start-start-radius: 16px; border-end-start-radius: 16px; }
  header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--pi-border); }
  .header-actions { display: flex; align-items: center; gap: 8px; }
  /* Positioned in every layout so the summoned control sheet has a pane to fill. */
  main { position: relative; grid-column: 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .context-bar { position: relative; flex: 0 0 auto; min-width: 0; display: none; align-items: center; gap: 0; padding: 6px 0; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
  .context-bar::before, .context-bar::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity var(--pi-motion-fast) ease; }
  .context-bar::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .context-bar::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .context-bar.can-scroll-left::before, .context-bar.can-scroll-right::after { opacity: 1; }
  .context-bar-label { display: none; }
  .context-items { flex: 1 1 auto; min-width: 0; display: flex; align-items: stretch; gap: 5px; margin: 0; padding: 0 8px; list-style: none; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scroll-padding-inline: 8px; scrollbar-width: thin; }
  .context-bar.has-context-actions .context-items { padding-right: 52px; scroll-padding-inline: 8px 52px; }
  .context-item { flex: 0 0 auto; min-width: 0; display: flex; }
  .context-actions { position: absolute; top: 6px; right: 0; bottom: 6px; z-index: 3; display: flex; align-items: center; padding: 0 8px 0 0; pointer-events: none; }
  .context-actions::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; z-index: 0; width: 26px; background: var(--pi-bg); pointer-events: none; }
  .context-chip { flex: 0 0 auto; min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-pill); background: var(--pi-surface); color: var(--pi-text); padding: 4px 8px; font: inherit; text-align: left; }
  .context-chip:hover { background: var(--pi-surface-hover); }
  .context-chip:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px; }
  .context-chip.empty { border-style: dashed; color: var(--pi-muted); }
  .context-kind { display: none; }
  .context-value { min-width: 0; overflow: visible; text-overflow: clip; white-space: nowrap; }
  app-session-tabs { flex: 0 0 auto; min-width: 0; }
  .mobile-navigation-panel { display: none; }
  .navigation-panel-edge, .workspace-panel-edge { min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: visible; background: var(--pi-border-muted); z-index: 2; }
  .navigation-panel-edge { grid-column: 2; }
  .workspace-panel-edge { grid-column: 4; }
  .navigation-panel-edge-button, .workspace-panel-edge-button { position: relative; z-index: 1; box-sizing: border-box; display: grid; place-items: center; width: 18px; height: 48px; padding: 0; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-pill); background: var(--pi-bg); color: var(--pi-muted); opacity: .75; cursor: pointer; }
  .navigation-panel-edge-button:hover, .navigation-panel-edge-button:focus-visible, .workspace-panel-edge-button:hover, .workspace-panel-edge-button:focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); opacity: 1; }
  .shell.navigation-panel-collapsed .navigation-panel-edge-button { transform: translateX(calc(50% - .5px)); }
  .shell.workspace-panel-collapsed .workspace-panel-edge-button { transform: translateX(calc(-50% + .5px)); }
  .navigation-panel-edge-icon, .workspace-panel-edge-icon { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  workspace-panel { min-width: 0; min-height: 0; overflow: hidden; }
  /*
   * Disclosure is measured from the shell's own box by AppShellController, not
   * from the viewport. The bar is the sum of the three panes' content minimums
   * (CHROME_RESIDENT_MIN_WIDTH), so the shell keeps three columns only while all
   * three can actually be read.
   */
  /*
   * A panel that is not docked takes no width, whatever band the shell is in.
   * These are keyed on what is docked rather than on disclosure, so a shell that
   * folds and unfolds gains and loses a column on the same terms.
   */
  .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; }
  .shell.workspace-panel-collapsed { --workspace-panel-width: 0px; }

  /*
   * A summoned shell with no docked workspace panel is a single-column shell:
   * the session owns it, and the workspace panel stacks underneath on request.
   * With the panel docked, the shell keeps its side-by-side columns instead --
   * the same arrangement a wider shell uses, minus the panes that do not fit.
   */
  .shell.chrome-summoned.workspace-panel-collapsed { grid-template-columns: var(--navigation-panel-width) 1px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .shell.chrome-summoned.workspace-panel-collapsed .panel-surface[data-side="navigation"] { grid-row: 1 / 3; }
  /*
   * The seam spans both rows only where there are two. It used to span them
   * whenever the shell was narrow, which created a second row the layout did
   * not want and squashed every column to content height.
   */
  .shell.chrome-summoned.workspace-panel-collapsed .navigation-panel-edge { grid-row: 1 / 3; }
  .shell.chrome-summoned.workspace-panel-collapsed .navigation-panel-edge { grid-row: 1 / 3; }
  .shell.chrome-summoned.workspace-panel-collapsed main { grid-column: 3; grid-row: 1 / 3; }
  .shell.chrome-summoned.workspace-panel-collapsed .workspace-panel-edge { display: none; }
  /*
   * A promoted tool owns the main surface, whatever the disclosure band: the
   * session tab band keeps main's row and the workspace surface fills the row
   * beneath it. The workspace column collapses because its panel has moved
   * into the main column; navigation keeps its own column and spans both rows.
   */
  .shell.workspace-view { grid-template-rows: auto minmax(0, 1fr); --workspace-panel-width: 0px; }
  .shell.workspace-view .panel-surface[data-side="navigation"] { grid-row: 1 / 3; }
  .shell.workspace-view .navigation-panel-edge { grid-row: 1 / 3; }
  .shell.workspace-view .workspace-panel-edge { display: none; }
  .shell.workspace-view main.workspace-view { grid-row: 1; min-height: auto; overflow: hidden; }
  .shell.workspace-view .panel-surface[data-side="workspace"]:not([data-mode="sheet"]) { grid-column: 3; grid-row: 2; display: flex; border-left: 0; }
  main.workspace-view chat-view, main.workspace-view prompt-editor, main.workspace-view .empty { display: none; }
  .shell.overlay-navigation { grid-template-columns: minmax(0, 1fr); }
  .shell.overlay-navigation .panel-surface[data-side="navigation"][data-mode="docked"], .shell.overlay-navigation .navigation-panel-edge { display: none; }
  /*
   * Overlay shells still run the summoned three-column grid (navigation's
   * track is just 0px), so the tabbed workspace aside keeps grid-column 3
   * from the workspace-view rules above; only main needs pinning here.
   */
  .shell.overlay-navigation main { grid-column: 1; }
  .shell.overlay-navigation .context-bar { display: flex; }
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
    animation: navigation-overlay-in var(--pi-motion-move) ease-out;
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

  /*
   * Dims what the sheet covers, by exactly as much of the sheet as shows. It
   * fades on the same clock the sheet slides on, so the two leave together;
   * under a finger both are written directly and neither eases.
   */
  .peek-scrim {
    transition: opacity var(--pi-motion-move) ease;
    position: absolute;
    inset: 0;
    z-index: 40;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: var(--pi-shadow);
    cursor: pointer;
  }

  .peek-scrim[data-tracking] { transition: none; }

  @media (prefers-reduced-motion: reduce) {
    .panel-surface, .peek-scrim { transition: none; }
  }

  chat-view { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  prompt-editor { flex: 0 0 auto; }
  button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  /*
   * The first screen: brand, one message, one filled primary, and the last
   * few conversations. Widths are intrinsic — the column caps itself and the
   * rows ellipsize — so every posture gets the same composition.
   */
  .empty { box-sizing: border-box; width: min(100%, 30rem); margin: auto; display: grid; justify-items: center; gap: var(--pi-space-md); padding: var(--pi-space-lg); color: var(--pi-muted); text-align: center; }
  .empty-brand { display: grid; justify-items: center; gap: 10px; margin-bottom: var(--pi-space-xs); color: var(--pi-dim); font-size: var(--pi-text-sm); font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; }
  .empty-brand-bar { width: 40px; height: 6px; border-radius: var(--pi-radius-pill); background: var(--pi-accent); }
  .empty-message { color: var(--pi-text); font-size: var(--pi-text-md); }
  .empty-session-action { display: inline-flex; align-items: center; gap: 6px; border-color: var(--pi-accent-border, var(--pi-accent)); background: var(--pi-accent); color: var(--pi-bg); font-weight: 650; }
  .empty-session-action:hover { background: color-mix(in srgb, var(--pi-accent) 86%, white); }
  .empty-session-action .new-session-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
  .empty-recents { width: 100%; margin-top: var(--pi-space-md); display: grid; gap: 4px; text-align: left; }
  .empty-recents-label { margin: 0 0 4px; padding-inline: 10px; color: var(--pi-dim); font-size: var(--pi-text-xs); font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; }
  .empty-recent-row { display: flex; align-items: baseline; gap: 12px; width: 100%; border: 0; border-radius: var(--pi-radius-control); background: transparent; color: var(--pi-text); padding: 8px 10px; text-align: left; cursor: pointer; }
  .empty-recent-row:hover { background: var(--pi-surface); }
  .empty-recent-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--pi-text-sm); }
  .empty-recent-meta { flex: 0 0 auto; color: var(--pi-dim); font-size: var(--pi-text-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .error { padding: 10px 16px; border-bottom: 1px solid var(--pi-border); color: var(--pi-danger); }

`;

export const composerDraftStyles = css`
  /* The draft's own chrome, named so the surface around it can do arithmetic
     with the distance from its border to the first character. Declared on the
     host of whichever composer embeds this sheet: the draft itself renders into
     light DOM and has no host of its own. */
  :host { --composer-draft-edge: 1px; --composer-draft-pad: 8px; }
  .editor-wrap { position: relative; min-width: 0; }
  .composer-live-region { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
  .markdown-editor .cm-editor { box-sizing: border-box; width: 100%; min-height: 54px; max-height: 220px; overflow: hidden; border-radius: var(--pi-radius-control); border: var(--composer-draft-edge, 1px) solid var(--pi-border-muted); background: var(--pi-bg); color: var(--pi-text); font: var(--pi-control-font-size, 16px)/1.4 var(--pi-control-font-family, system-ui, sans-serif); }
  .markdown-editor .cm-scroller { max-height: 220px; overflow-y: auto; font-family: var(--pi-control-font-family, system-ui, sans-serif); line-height: 1.4; }
  .markdown-editor .cm-content { min-height: 38px; padding: var(--composer-draft-pad, 8px); caret-color: var(--pi-text); text-align: start; unicode-bidi: plaintext; }
  .markdown-editor .cm-line { padding: 0; unicode-bidi: plaintext; }
  .markdown-editor .cm-placeholder { color: var(--pi-dim); }
  /* The draft's leading command token wears the command mark in place: still
     editable text, dressed as the chip the menu introduced. The editor sits on
     --pi-bg, so the chip lifts to --pi-surface — the inverse of the menu. */
  .markdown-editor .cm-command-mark { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-inline); background: var(--pi-surface); padding: 0 4px 1px; font: 500 0.9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .markdown-editor .cm-code-block-header { box-sizing: border-box; min-width: 0; border: 1px solid var(--pi-border); border-bottom: 0; border-radius: var(--pi-radius-control) var(--pi-radius-control) 0 0; background: var(--pi-surface); color: var(--pi-muted); padding: 4px 8px; overflow: hidden; font: 600 var(--pi-text-xs) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .04em; text-overflow: ellipsis; white-space: nowrap; }
  .markdown-editor .cm-code-block-body { box-sizing: border-box; inline-size: 100%; min-inline-size: 0; max-inline-size: 100%; contain: inline-size; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; border-inline: 1px solid var(--pi-border); background: var(--pi-bg); padding-inline: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .markdown-editor .cm-code-block-body .cm-line { min-width: max-content; min-height: 1.4em; white-space: pre; overflow-wrap: normal; word-break: normal; }
  .markdown-editor .cm-code-block-footer { box-sizing: border-box; min-height: 6px; border: 1px solid var(--pi-border); border-top: 0; border-radius: 0 0 var(--pi-radius-control) var(--pi-radius-control); background: var(--pi-bg); }
  .markdown-editor .cm-code-block-footer.cm-code-block-empty { min-height: calc(1.4em + 6px); cursor: text; }
  .markdown-editor .cm-code-block-footer.cm-code-block-empty:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: -3px; }
  .markdown-editor .tok-comment { color: var(--pi-muted); font-style: italic; }
  .markdown-editor :is(.tok-keyword, .tok-typeName, .tok-className, .tok-variableName2) { color: var(--pi-purple); }
  .markdown-editor :is(.tok-propertyName, .tok-labelName, .tok-namespace) { color: var(--pi-accent); }
  .markdown-editor :is(.tok-literal, .tok-number, .tok-bool, .tok-atom, .tok-operator) { color: var(--pi-warning); }
  .markdown-editor :is(.tok-string, .tok-string2, .tok-inserted) { color: var(--pi-success); }
  .markdown-editor :is(.tok-invalid, .tok-deleted) { color: var(--pi-danger); }
  .markdown-editor :is(.tok-meta, .tok-punctuation) { color: var(--pi-muted); }
  .markdown-editor :is(.tok-heading, .tok-strong) { font-weight: 600; }
  .markdown-editor .tok-emphasis { font-style: italic; }
  .markdown-editor .tok-strikethrough { text-decoration: line-through; }
  .markdown-editor :is(.tok-link, .tok-url) { color: var(--pi-accent); text-decoration: underline; }
  .markdown-editor .cm-focused { outline: none; }
  .shell-mode .markdown-editor .cm-editor { border-color: var(--pi-success); box-shadow: 0 0 0 1px var(--pi-success-ring); }
  .resting { gap: 6px; padding-block: 7px; }
  .resting .markdown-editor .cm-editor { min-height: 38px; }
  .resting .markdown-editor .cm-content { min-height: 22px; padding-block: 6px; }
  .mode-hint { position: absolute; right: 8px; bottom: 8px; max-width: calc(100% - 54px); border: 1px solid var(--pi-success-border); border-radius: var(--pi-radius-pill); background: var(--pi-success-surface); color: var(--pi-success); padding: 2px 8px; font-size: var(--pi-text-sm); pointer-events: none; }
  .attachments { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
  .attachment-chip { position: relative; width: 56px; height: 56px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); overflow: hidden; background: var(--pi-bg); }
  .attachment-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .attachment-chip-file { display: grid; place-items: center; }
  .attachment-file-preview { display: grid; place-items: center; width: 34px; height: 26px; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-inline); background: var(--pi-surface); color: var(--pi-muted); font: 700 10px/1 system-ui, sans-serif; letter-spacing: .03em; }
  .attachment-file-name { position: absolute; right: 4px; bottom: 3px; left: 4px; overflow: hidden; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1.2; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
  .attachment-remove { position: absolute; top: 1px; right: 1px; width: 18px; min-height: 18px; height: 18px; padding: 0; line-height: 16px; border-radius: 50%; border: 1px solid var(--pi-border); background: var(--pi-surface); color: var(--pi-text); font-size: var(--pi-text-sm); cursor: pointer; }
  .attachment-chip:focus-visible, .attachment-remove:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px; }
  .attachment-delivery { min-width: min(100%, 18rem); display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0; padding: 7px 9px; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-control); }
  .attachment-delivery legend { padding: 0 4px; color: var(--pi-muted); font-size: var(--pi-text-sm); }
  .attachment-delivery label { display: inline-flex; align-items: center; gap: 5px; color: var(--pi-text); font-size: var(--pi-text-sm); }
  .attachment-delivery input { margin: 0; accent-color: var(--pi-accent); }
  .attachment-delivery input:disabled + span { color: var(--pi-dim); }
  .attachment-delivery-fixed { color: var(--pi-muted); font-size: var(--pi-text-sm); }
  .attachment-error { flex-basis: 100%; color: var(--pi-danger); font-size: var(--pi-text-sm); }
  .markdown-editor-disabled .cm-editor { opacity: .5; cursor: not-allowed; }
`;

export const newSessionComposerStyles = css`
  ${composerDraftStyles}
  :host { position: fixed; inset: 0; z-index: 40; display: block; color: var(--pi-text); font: var(--pi-text-md) system-ui, sans-serif; container-type: size; }
  /* The composer island is the surface. A dialog box around it would draw a
     second border, a second background, and a second shadow around something
     that already has all three. */
  modal-surface {
    --modal-surface-background: transparent;
    /* The composer anchors its choices to its own controls, and they open
       above the island. A clipping dialog paints them away entirely. */
    --modal-surface-overflow: visible;
    --modal-surface-border: none;
    --modal-surface-shadow: none;
    --modal-surface-radius: 0;
    --modal-surface-width: min(42rem, calc(100% - clamp(1rem, 4cqi, 2rem)));
    --modal-surface-height: auto;
    --modal-surface-max-width: 100%;
    --modal-surface-max-height: calc(100% - clamp(1rem, 4cqb, 2rem));
  }
  .composer { box-sizing: border-box; max-height: calc(100cqb - clamp(1rem, 4cqb, 2rem)); min-height: 0; display: flex; flex-direction: column; }
  .dialog-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: clamp(0.875rem, 2.5cqi, 1.25rem); }
  .field { display: grid; gap: 0.5rem; min-width: 0; }
  .field + .field { margin-top: clamp(1rem, 3cqi, 1.5rem); }
  .field-label { margin: 0; color: var(--pi-muted); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
  .destination-summary { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; }
  .destination-copy { min-width: 0; overflow: hidden; }
  .destination-identity { min-width: 0; display: flex; align-items: baseline; white-space: nowrap; }
  .destination-part { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .destination-project, .destination-machine { flex: 0 0 auto; }
  .destination-workspace { flex: 1 1 auto; }
  .destination-separator { flex: 0 0 auto; margin-inline: 0.25rem; }
  .destination-copy small { min-width: 0; color: var(--pi-muted); overflow-wrap: anywhere; white-space: normal; }
  .destination-required { display: grid; gap: 0.2rem; color: var(--pi-muted); }
  .chooser { min-width: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-surface); overflow: hidden; }
  .chooser:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px; }
  .chooser-heading { margin: 0; padding: 0.75rem; border-bottom: 1px solid var(--pi-border-muted); color: var(--pi-text); font-size: 0.875rem; }
  .catalog-state { display: grid; gap: 0.75rem; justify-items: start; padding: clamp(1rem, 3cqi, 1.5rem) 0.75rem; color: var(--pi-muted); }
  .catalog-state p { margin: 0; overflow-wrap: anywhere; }
  .catalog-state.error { color: var(--pi-danger); }
  .catalog-list { max-height: min(16rem, 35cqb); margin: 0; padding: 0; overflow-y: auto; list-style: none; }
  .catalog-item { width: 100%; min-height: 2.75rem; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; padding: 0.65rem 0.75rem; border: 0; border-bottom: 1px solid var(--pi-border-muted); border-radius: 0; background: transparent; color: var(--pi-text); font: inherit; text-align: left; cursor: pointer; }
  .catalog-list li:last-child .catalog-item { border-bottom: 0; }
  .catalog-item:hover, .catalog-item:focus-visible { background: var(--pi-surface-hover); }
  .catalog-item:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: -2px; }
  .catalog-item:disabled { color: var(--pi-dim); cursor: not-allowed; }
  .catalog-item-copy { min-width: 0; display: grid; gap: 0.2rem; }
  .catalog-item-copy strong, .catalog-item-copy small { min-width: 0; overflow-wrap: anywhere; white-space: normal; }
  .catalog-item-copy small, .catalog-meta { color: var(--pi-muted); }
  .catalog-back { display: flex; justify-content: flex-start; padding: 0.5rem 0.75rem; border-top: 1px solid var(--pi-border-muted); }
  composer-draft { display: block; min-width: 0; }
  composer-draft .markdown-editor .cm-editor { min-height: clamp(5rem, 12cqb, 7rem); max-height: min(18rem, 42cqb); }
  composer-draft .markdown-editor .cm-scroller { max-height: min(18rem, 42cqb); }
  .submission-error { margin: 0.75rem 0 0; padding: 0.75rem; border: 1px solid var(--pi-danger); border-radius: var(--pi-radius-control); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-surface)); color: var(--pi-text); overflow-wrap: anywhere; }
  .dialog-footer { flex: 0 0 auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; padding: clamp(0.625rem, 2cqi, 0.875rem) clamp(0.875rem, 2.5cqi, 1.25rem); border-top: 1px solid var(--pi-border); background: var(--pi-bg); }
  button { min-height: 2.75rem; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-surface); color: var(--pi-text); padding: 0 1rem; font: inherit; cursor: pointer; }
  button:hover:not(:disabled), button:focus-visible { background: var(--pi-surface-hover); }
  button:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .primary { border-color: var(--pi-accent-border, var(--pi-accent)); background: var(--pi-selection-bg); }
  .busy-label { align-self: center; margin-right: auto; color: var(--pi-muted); }
`;

export const workspacePanelStyles = css`
  :host { display: flex; flex-direction: column; min-height: 0; color: var(--pi-text); background: var(--pi-bg); font: var(--pi-text-sm) system-ui, sans-serif; container-type: inline-size; }
  header { flex: 0 0 auto; min-width: 0; display: flex; align-items: stretch; border-bottom: 1px solid var(--pi-border); }
  .workspace-header-scroll-frame { position: relative; flex: 1 1 auto; min-width: 0; background: var(--pi-bg); }
  .workspace-header-action { flex: 0 0 auto; align-self: center; margin: 8px; margin-left: auto; white-space: nowrap; }
  .workspace-header-action .new-session-icon { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
  .workspace-header-scroll-frame::before, .workspace-header-scroll-frame::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 18px; opacity: 0; pointer-events: none; transition: opacity var(--pi-motion-fast) ease; }
  .workspace-header-scroll-frame::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .workspace-header-scroll-frame::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .workspace-header-scroll-frame.can-scroll-left::before, .workspace-header-scroll-frame.can-scroll-right::after { opacity: 1; }
  .workspace-header-strip { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0; padding: 8px; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; }
  .tabs { flex: 0 0 auto; display: flex; gap: 6px; align-items: center; }
  .tabs button { flex: 0 0 auto; white-space: nowrap; }
  .tabs button.icon-tab { min-width: 34px; }
  /*
   * Panel chrome is ghost by default: the tool strip and header actions are
   * wayfinding, not content, so they carry no boxes. Selection is the one
   * filled state; the transparent border keeps layout stable against it.
   */
  button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid transparent; border-radius: var(--pi-radius-control); background: transparent; color: var(--pi-muted); padding: 5px 7px; cursor: pointer; }
  button:hover { background: var(--pi-surface); color: var(--pi-text); }
  button.selected { background: var(--pi-selection-bg); color: var(--pi-text); }
  .tab-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .tab-custom-icon { flex: 0 0 auto; width: 16px; height: 16px; display: inline-grid; place-items: center; color: currentColor; pointer-events: none; }
  .tab-custom-icon svg { width: 16px; height: 16px; pointer-events: none; }
  .tab-label { min-width: 0; }
  .tab-badge { flex: 0 0 auto; display: inline-block; min-width: 14px; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-pill); background: var(--pi-surface); color: var(--pi-text-secondary); padding: 0 5px; font-size: var(--pi-text-xs); line-height: 16px; text-align: center; }
  @container (max-width: 430px) {
    .tabs button.icon-tab { justify-content: center; padding-inline: 7px; }
    .tabs button.icon-tab .tab-label, .workspace-header-action-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
  }
  .panel-content { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
  .panel-content[hidden] { display: none; }
  /* An empty panel keeps a header for its own controls, and nothing else. */
  header.empty-state-header { justify-content: flex-end; align-items: center; padding: 6px; border-bottom: 0; }
  .empty-state { box-sizing: border-box; width: min(100%, 380px); margin: auto; padding: 24px; display: grid; gap: 8px; color: var(--pi-muted); text-align: center; }
  .empty-state h2 { margin: 0; color: var(--pi-text); font-size: var(--pi-text-md); line-height: 1.3; }
  .empty-state p { margin: 0; line-height: 1.45; }
  small, .muted { color: var(--pi-muted); }
  /*
   * Whether this panel carries its own tool strip is the shell's decision, not
   * a width's: it depends on whether something else is already showing one.
   * See WorkspacePanel.hideToolTabs, set by the composition root.
   */
  .workspace-label { min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; max-width: 100%; overflow: hidden; white-space: nowrap; }
  .workspace-label-base, .workspace-label-item, .workspace-label-render { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .workspace-label-item, .workspace-label-render, .workspace-label-separator { color: var(--pi-muted); }
  .workspace-label-link { color: var(--pi-accent); text-decoration: none; }
  .workspace-label-link:hover, .workspace-label-link:focus { text-decoration: underline; }
  .toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid var(--pi-border-muted); }
  .toolbar button { margin-left: auto; }
  .stale { border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-pill); color: var(--pi-warning); padding: 1px 6px; font-size: var(--pi-text-sm); }
  .split { flex: 1 1 auto; min-height: 0; display: grid; grid-template-rows: minmax(160px, 34%) minmax(0, 1fr); }
  .list { min-height: 0; overflow: auto; border-bottom: 1px solid var(--pi-border); padding: 6px; }
  .row { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 4px; width: 100%; border: 0; border-radius: var(--pi-radius-inline); background: transparent; text-align: left; padding: 4px 6px 4px calc(6px + var(--depth, 0) * 14px); }
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
  .image-preview img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-control); background-color: var(--pi-surface); background-image: linear-gradient(45deg, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 25%, transparent 25%), linear-gradient(-45deg, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 75%), linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; box-shadow: 0 8px 24px var(--pi-shadow-soft); }
  pre { margin: 0; padding: 10px; overflow: auto; font: var(--pi-text-sm) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  p { margin: 10px; }
`;

export const listStyles = css`
  :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden; color: var(--pi-text); font: var(--pi-text-md) system-ui, sans-serif; }
  :host([collapsed]) { flex: 0 0 auto; min-height: auto; overflow: hidden; }
  section { box-sizing: border-box; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 10px; }
  h2 { flex: 0 0 auto; display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 0 0 8px; color: var(--pi-muted); font-size: var(--pi-text-sm); text-transform: uppercase; }
  .list-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
  button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  section > button { display: block; width: 100%; text-align: left; margin: 6px 0; }
  .subheading { margin-top: 14px; }
  .section-toggle { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; width: 100%; border: 0; background: transparent; color: inherit; padding: 0; font: inherit; text-align: left; text-transform: inherit; }
  .section-toggle span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .section-title { display: grid; gap: 2px; min-width: 0; }
  .section-toggle .section-selected { display: block; color: var(--pi-text); font-size: var(--pi-text-sm); font-weight: 600; line-height: 1.25; text-transform: none; }
  .section-toggle .section-count { flex: 0 0 auto; display: inline; color: var(--pi-muted); font-size: inherit; }
  .section-toggle small { display: inline; color: inherit; font-size: inherit; }
  .action-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; margin: 6px 0; cursor: pointer; }
  .action-row:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px; border-radius: var(--pi-radius-control); }
  .action-row.selected .action-main, .action-row.selected .action-menu-toggle { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .action-row.archived .action-main { color: var(--pi-muted); }
  .action-main { position: relative; box-sizing: border-box; min-width: 0; width: 100%; border: 1px solid var(--pi-border); border-top-right-radius: 0; border-bottom-right-radius: 0; border-top-left-radius: 8px; border-bottom-left-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 22px 7px calc(9px + var(--depth, 0) * 16px); text-align: left; }
  .action-name { display: -webkit-box; max-height: 2.5em; overflow: hidden; overflow-wrap: anywhere; line-height: 1.25; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .action-row:not(.selected):hover .action-main { background: var(--pi-surface-hover); }
  .workspace-row .action-main { border-radius: var(--pi-radius-control) 0 0 var(--pi-radius-control); }
  .workspace-primary { min-width: 0; display: flex; align-items: baseline; gap: 6px; }
  .workspace-primary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-status { flex: 0 0 auto; color: var(--pi-warning); font-size: var(--pi-text-sm); }
  .workspace-secondary { margin-top: 3px; }
  .workspace-menu-panel { width: max-content; min-width: min(120px, calc(100vw - 16px)); padding: 8px; }
  .workspace-menu-actions { margin: 0 0 8px; padding-bottom: 8px; border-bottom: 1px solid var(--pi-border-muted); }
  .workspace-menu-actions button.danger { color: var(--pi-danger); }
  .workspace-menu-actions button.danger:hover, .workspace-menu-actions button.danger:focus { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
  .workspace-menu-details { display: grid; gap: 6px; margin: 0; }
  .workspace-detail-row { display: grid; grid-template-columns: minmax(58px, max-content) minmax(0, 1fr); gap: 8px; align-items: baseline; }
  .workspace-detail-row dt { color: var(--pi-muted); font-size: var(--pi-text-sm); white-space: normal; }
  .workspace-detail-row dd { min-width: 0; margin: 0; overflow-wrap: anywhere; white-space: normal; }
  .action-menu-panel .detail-copy { box-sizing: border-box; display: inline-grid; place-items: center; width: 18px; height: 18px; margin-left: 6px; padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-inline); background: transparent; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1; cursor: pointer; vertical-align: middle; }
  .action-menu-panel .detail-copy:hover, .action-menu-panel .detail-copy:focus { color: var(--pi-text); border-color: var(--pi-accent); background: var(--pi-surface-hover); }
  .tree-marker { color: var(--pi-dim); margin-right: 5px; }
  .badge { display: inline-block; margin-left: 5px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); color: var(--pi-muted); padding: 0 5px; font-size: var(--pi-text-xs); font-weight: 400; }
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
  @media (prefers-reduced-motion: reduce) { .activity-indicator { animation: none; } }
  .action-activity .unread-ring { margin: 0; vertical-align: 0; }
  .action-menu { position: relative; align-self: stretch; }
  .action-menu-toggle { display: grid; place-items: center; height: 100%; min-width: 32px; padding: 0; color: var(--pi-muted); border-left: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; }
  .action-menu-toggle:hover { color: var(--pi-text); background: var(--pi-surface-hover); }
  .action-menu-panel { position: fixed; z-index: 50; box-sizing: border-box; min-width: min(120px, calc(100vw - 16px)); overflow: auto; padding: 4px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-surface); box-shadow: 0 8px 24px var(--pi-shadow); overflow-wrap: anywhere; }
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

/*
 * A slash command, typeset as an instrument reading rather than a badge:
 * the same hairline-and-mono family as inline code, with the sigil dimmed so
 * the name carries the weight. One definition; the completion menu and the
 * queued ghosts both interpolate it, so the mark cannot drift between them.
 */
const commandMarkStyles = css`
  .command-mark { display: inline-flex; align-items: baseline; max-width: 100%; padding: 1px 6px 1px 4px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-inline); background: var(--pi-bg); color: var(--pi-text); font: 500 var(--pi-text-sm) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.4; white-space: nowrap; }
  .command-mark .command-sigil { flex: 0 0 auto; margin-inline-end: 1px; color: var(--pi-muted); font-weight: 400; }
  .command-mark .command-name { overflow: hidden; text-overflow: ellipsis; }
`;

export const chatStyles = css`
  ${commandMarkStyles}
  :host { position: relative; z-index: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; color: var(--pi-text); font: var(--pi-text-md) system-ui, sans-serif; }
  /* Size container for the transcript. The wrapper is sized by the flex column
     above it, never by its own contents, so size containment costs it nothing. */
  .chat-wrap { container-type: size; position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .top-notices { box-sizing: border-box; flex: 0 0 auto; max-height: 40%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg-overlay); }
  .session-warnings { flex: 0 1 auto; display: grid; gap: 8px; max-height: 50%; min-height: 0; overflow-y: auto; box-sizing: border-box; padding: 10px 16px; border-bottom: 1px solid var(--pi-border-muted); }
  .session-warnings:only-child { flex: 1 1 auto; max-height: 100%; border-bottom: 0; }
  .session-warnings-controls { display: flex; justify-content: flex-end; }
  .session-warnings-collapse { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-surface); color: var(--pi-muted); padding: 4px 7px; font: var(--pi-text-sm) system-ui, sans-serif; cursor: pointer; }
  .session-warnings-collapse:hover, .session-warnings-collapse:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); background: var(--pi-bg-overlay); }
  .session-warnings-collapse:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px; }
  .session-warnings-collapse-icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .session-warning { position: relative; display: grid; gap: 4px; box-sizing: border-box; padding: 10px 34px 10px 12px; border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-surface); background: var(--pi-warning-surface); color: var(--pi-text); }
  .session-warning.error { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 12%, var(--pi-surface)); }
  .session-warning.info { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
  .session-warning-head { display: flex; align-items: center; gap: 8px; min-height: 16px; }
  .session-warning-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .session-warning-body { min-width: 0; display: grid; gap: 3px; }
  .session-warning-message { margin: 0; overflow-wrap: anywhere; }
  .session-warning-path { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-sm); font-family: var(--pi-mono, ui-monospace, monospace); overflow-wrap: anywhere; }
  .session-warning-source { color: var(--pi-muted); font-size: var(--pi-text-xs); text-transform: uppercase; letter-spacing: .04em; }
  .session-warning-dismiss { position: absolute; top: 6px; right: 6px; display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-surface); color: var(--pi-muted); font: 15px/1 system-ui, sans-serif; cursor: pointer; }
  .session-warning-dismiss:hover, .session-warning-dismiss:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); background: var(--pi-bg-overlay); }
  .session-warning-dismiss:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px; }
  .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important; }
  .notification-live span { display: block; }
  /* Reading column. A centred single-track grid rather than per-child
     max-width plus auto margins: several transcript children declare margin
     shorthands later in this sheet, which would silently reset margin-inline
     and left-align the column. The track owns the width, so child rules cannot
     fight it. */
  /* One column. The track is the reading measure, and everything the reader
     reads or writes lives in it: prose, cards, the activity fold, and the
     composer below. Nothing computes a width of its own; it inherits the track,
     so a new kind of message cannot arrive at some other width by forgetting a
     rule.

     Content that is not prose keeps the track's start edge and runs past its
     end into the bleed -- see the feature rule in the prose sheet. The bleed is
     free space beside the column, not part of it: a column as wide as the
     widest table would leave that much emptiness on every screen without one. */
  /*
   * While a finger is the input, prose stops being selectable so the shell's
   * long press can survive. On a touch platform the system selection callout
   * fires first and takes the pointer stream with it, so any hold over text
   * reads as broken rather than as unavailable. Code keeps its selection: it
   * is what a reader actually copies out of a transcript, and the summon
   * gesture stands aside over it for the same reason.
   *
   * A mouse is unaffected -- observeInputMode sets the property to 'text'.
   *
   * TEMPORARILY SUSPENDED (2026-08-31): the long-press radial menu is disabled,
   * so observeInputMode gives touch 'text' as well and the callout is allowed
   * back. A hold over prose now raises the platform's own select/copy menu.
   * Restore the callout to 'none' here when the wheel is re-armed.
   */
  .chat { -webkit-user-select: var(--pi-prose-user-select, text); user-select: var(--pi-prose-user-select, text); -webkit-touch-callout: default; }
  .chat pre, .chat code, .chat textarea, .chat input {
    -webkit-user-select: text;
    user-select: text;
    -webkit-touch-callout: default;
  }

  /* The transcript hangs from the composer, and its rows are the height of
     what is in them.

     A grid without a stated align-content stretches every auto row by an equal
     share of the leftover height. A transcript with less content than scroller
     was therefore spread across the whole pane: bands of dead space between the
     history control, the range line, and the first message, and a pill button
     grown into a full-height capsule. Reading rhythm belongs to the messages,
     so the rows are packed to their content instead.

     The slack goes to one leading spacer row, sized minmax(0, 1fr) so it
     collapses to nothing as soon as the transcript is taller than the scroller.
     A spacer that could not collapse would push the first message above the
     scroll origin, where no amount of scrolling reaches it. */
  .chat { --pi-chat-sticky-top: -26px; --pi-chat-pad-block-start: 26px; --pi-chat-pad-block-end: 16px; display: grid; grid-template-columns: minmax(0, var(--calm-measure)); grid-template-rows: minmax(0, 1fr); align-content: start; justify-content: center; height: 100%; min-height: 0; overflow: auto; overflow-anchor: none; padding: var(--pi-chat-pad-block-start) var(--calm-gutter) var(--pi-chat-pad-block-end); box-sizing: border-box; }
  .chat[data-scroll-owner="reader"] { overflow-anchor: auto; }
  .chat::before { content: ""; }
  .chat-content { min-width: 0; }
  /* One human message and its reply share a stable keyed box. */
  .turn { min-width: 0; display: block; }
  .turn-body { min-width: 0; }
  /* Transcript messages carry no card. Roles are told apart by weight and
     tone, not by a border and fill per role: colour is reserved for things
     that need attention, and a colour per role spends it on everything. */
  /* Paragraph rhythm by default; the wide gap is added back only at a turn
     boundary below. Spacing keys on the message role so group wrappers do not
     change the transcript rhythm. */
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
  .msg.user, .msg.assistant { font-size: var(--pi-text-md); }
  .msg.user {
    /* A bubble is a container, not a page: content inside it stays inside it. */
    --calm-bleed: 0px;
    width: fit-content;
    max-width: min(100%, 30rem);
    margin-inline-start: auto;
    border: 1px solid var(--calm-rule);
    border-radius: var(--pi-radius-surface);
    background: var(--calm-canvas-soft);
    padding: 12px 16px;
  }
  /* The first prompt already belongs to the turn, but its session has not
     accepted it yet. Keep the normal user shape and use the queue's dashed,
     muted treatment until the canonical transcript replaces it. */
  .msg.user.pending-session-launch {
    border-style: dashed;
    background: color-mix(in srgb, var(--calm-canvas-soft) 55%, transparent);
    color: var(--calm-ink-muted);
  }
  .msg.tool, .msg.bash, .msg.skill { color: var(--calm-ink-dim); }
  .msg.tool-execution-shell, .msg.ask-user-record-shell { padding: 0; border: 0; background: transparent; color: var(--calm-ink-muted); }
  .msg.ask-user-record-shell ask-user-card { margin: 0 auto; }
  .msg.system { color: var(--calm-ink-muted); }
  /* The activity fold. A quiet line when closed; hairline blocks when open.
     No fills or radii inside: a fold must not reintroduce the card texture the
     transcript drops. */
  .msg.event-group { padding: 0; border: 0; background: none; color: var(--calm-ink-dim); }
  .msg.event-group > summary { display: flex; align-items: baseline; gap: 8px; padding: 0; border: 0; background: none; color: var(--calm-ink-dim); font-size: var(--pi-text-sm); list-style: none; cursor: pointer; }
  .msg.event-group > summary::-webkit-details-marker { display: none; }
  .msg.event-group > summary::before { content: "▸"; color: var(--calm-ink-dim); font-size: var(--pi-text-xs); }
  .msg.event-group[open] > summary::before { content: "▾"; }
  .msg.event-group > summary:hover, .msg.event-group > summary:focus-visible { color: var(--calm-ink-muted); }
  .msg.event-group > summary .label { margin: 0; }
  /* The process rail. Everything between the opener and the answer shares one
     hairline: narration in the working voice, step folds in the order they
     happened, and the turn's meta closing the rail. The answer stands outside
     it, back at full voice. */
  .turn-rail { min-width: 0; display: flex; flex-direction: column; gap: 12px; margin: 0 0 var(--calm-para-gap); padding-inline-start: clamp(12px, 2.5cqi, 18px); border-inline-start: 1px solid var(--calm-rule); }
  .turn-rail .msg { margin: 0; }
  /* The step ledger behind the collapsed register. It keeps the rail's own
     rhythm when open and leaves the DOM untouched when closed, so opening it
     never reflows what the reader was already looking at. */
  .rail-ledger { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
  .rail-ledger.flat { gap: 0; }
  .rail-ledger[hidden] { display: none; }
  .rail-flat-activity { min-width: 0; display: grid; }
  .rail-tool-segment { min-width: 0; border-bottom: 1px solid var(--pi-border-muted); }
  .rail-activity-row { min-width: 0; margin: 0; padding: 5px 0; border-bottom: 1px solid var(--pi-border-muted); }
  .rail-tool-segment:last-child, .rail-activity-row:last-child { border-bottom: 0; }
  .rail-thinking { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 7px; }
  .rail-thinking .rail-activity-glyph { color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1.6; }
  .rail-thinking .rail-activity-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
  .rail-thinking formatted-text { display: block; min-width: 0; }
  .rail-activity-row .part:is(details) { border-top: 0; padding-top: 0; }
  .rail-activity-row .part:is(details) > summary { display: flex; align-items: baseline; gap: 7px; list-style: none; }
  .rail-activity-row .part:is(details) > summary::-webkit-details-marker { display: none; }
  .rail-activity-row .part:is(details) > summary::before { content: "●"; flex: 0 0 auto; color: var(--pi-muted); font-size: var(--pi-text-xs); }
  /* Interim narration is the agent working, not the agent answering. It keeps
     reading order but drops to the interface's small muted voice, so the
     promoted answer is the only assistant prose at full size. */
  .msg.assistant.interim { font-size: var(--pi-text-sm); color: var(--calm-ink-muted); }
  /* One rail is enough: step blocks inside an open fold keep their indent but
     drop their own rule when the rail already draws one. */
  .turn-rail .group-msg { border-left: 0; }
  /* The turn's time and model close the rail: one quiet line per turn rather
     than a row above every paragraph.

     Stays readable text on touch. Elsewhere a metadata row collapses to an
     information glyph on a device that cannot hover, because it would otherwise
     sit visible above every message forever -- but this line appears once per
     turn and is meant to be read without asking for it. */
  .rail-meta { margin: 0; font-size: var(--pi-text-xs); }
  .rail-meta .msg-meta { opacity: 1; color: var(--calm-ink-dim); text-align: left; }
  .rail-meta .msg-meta:not(.expanded) { display: inline; width: auto; max-width: none; height: auto; font-size: var(--pi-text-xs); text-overflow: ellipsis; }
  .rail-meta .msg-meta::before { content: none; }
  .group-body { display: grid; gap: 18px; margin-top: 14px; padding: 0; }
  /* Tool images are one visual output of the turn, not a run of full-height
     tool messages. The gallery sits at answer weight outside the process rail,
     but keeps the transcript's quiet rules and palette instead of introducing
     a new card language. */
  .turn-image-gallery { min-width: 0; display: grid; gap: 7px; margin: 0 0 var(--calm-para-gap); padding: 8px 0 10px; border-block: 1px solid var(--calm-rule); }
  .turn-image-gallery-head { display: flex; align-items: baseline; gap: 7px; color: var(--calm-ink-dim); font-size: var(--pi-text-xs); }
  .turn-image-gallery-head strong { color: var(--calm-ink-muted); font-weight: 500; }
  .turn-image-gallery-strip { min-width: 0; display: flex; gap: clamp(5px, 1.4cqi, 8px); }
  .turn-image-gallery-thumb, .turn-image-gallery-more { min-width: 0; height: clamp(56px, 12cqi, 72px); flex: 1 1 0; box-sizing: border-box; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-control); background: var(--calm-canvas-soft); color: var(--calm-ink-muted); padding: 0; overflow: hidden; cursor: zoom-in; }
  .turn-image-gallery-thumb:hover, .turn-image-gallery-thumb:focus-visible, .turn-image-gallery-more:hover, .turn-image-gallery-more:focus-visible { border-color: var(--pi-accent); color: var(--pi-text-bright); background: var(--pi-surface-hover); }
  .turn-image-gallery-thumb:focus-visible, .turn-image-gallery-more:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px; }
  .turn-image-gallery-thumb { flex: 0 1 clamp(72px, 20cqi, 112px); }
  .turn-image-gallery-thumb img { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  .turn-image-gallery-more { flex: 0 0 clamp(48px, 12cqi, 64px); font: 500 var(--pi-text-sm) system-ui, sans-serif; cursor: pointer; }
  /* An inline image occupies a band of fixed height. The height is definite
     before the file arrives, so a late decode cannot grow the transcript under
     the reader and move what they are reading. The image is contained inside
     the band rather than cropped, and the band carries the soft canvas so the
     space beside a tall image reads as a frame and not as a gap. Full size is
     one tap away in the lightbox.

     The band answers to both axes of the transcript. Width alone would give a
     folded landscape screen a 200px band inside a viewport of about 374px,
     where the band and the composer leave no room to read. The block term caps
     the band against the height the transcript actually has. */
  .chat-image { display: block; box-sizing: border-box; inline-size: 100%; block-size: clamp(120px, min(30cqi, 45cqb), 200px); margin: 8px 0 0; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-control); background: var(--calm-canvas-soft); object-fit: contain; cursor: zoom-in; }
  .chat-image:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px; }
  .group-msg { max-width: 100%; min-width: 0; box-sizing: border-box; padding: 0 0 0 12px; border-top: 0; border-left: 1px solid var(--calm-rule); color: var(--calm-ink-dim); overflow: visible; }
  .group-msg.tool, .group-msg.tool-execution-shell, .group-msg.bash { color: var(--calm-ink-dim); }
  .group-msg.system { color: var(--calm-ink-muted); }
  .history-boundary { position: relative; z-index: 5; display: grid; gap: 3px; justify-items: center; margin: 0 0 14px; overflow-anchor: none; color: var(--pi-muted); font-size: var(--pi-text-sm); text-align: center; }
  .chat-empty-state, .chat-load-state { color: var(--pi-muted); font-size: var(--pi-text-sm); line-height: 1.45; }
  .chat-empty-state strong, .chat-load-state strong { color: var(--pi-text-secondary); font-weight: 600; }
  /* A screen with no transcript centres its one line of text, and says so
     itself. An auto margin cannot do it any more: that needs free space inside
     the grid area to divide, and a content-sized row has none. The box claims
     the scroller's inner height from the sizing container above it, which also
     collapses the leading spacer, so the text lands in the middle of the pane. */
  .chat-empty-state, .chat-load-state.empty { min-block-size: calc(100cqb - var(--pi-chat-pad-block-start) - var(--pi-chat-pad-block-end)); align-content: center; }
  .chat-empty-state { box-sizing: border-box; width: min(100%, 380px); margin-inline: auto; padding: 24px; display: grid; gap: 4px; justify-items: center; text-align: center; }
  .chat-load-state.empty { box-sizing: border-box; width: min(100%, 420px); margin-inline: auto; padding: 24px; display: grid; gap: 6px; justify-items: center; text-align: center; }
  .chat-load-state.inline { position: relative; z-index: 5; box-sizing: border-box; margin: 0 0 14px; padding: 8px 11px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-surface); background: var(--pi-bg-overlay); }
  .chat-load-state.failure { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 8%, var(--pi-surface)); color: var(--pi-text); }
  .chat-load-state.failure strong { color: var(--pi-text-bright); }
  .chat-load-retry { padding: 5px 10px; border-radius: var(--pi-radius-pill); }
  .history-load-button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); background: var(--pi-surface); color: var(--pi-text-secondary); padding: 5px 12px; font: var(--pi-text-sm) system-ui, sans-serif; cursor: pointer; }
  .history-load-button:hover, .history-load-button:focus { border-color: var(--pi-accent); color: var(--pi-text-bright); }
  .history-load-button:disabled { cursor: default; opacity: .55; }
  /* The failure signal, then the reason. Only the lead takes the danger tone;
     a fully coloured line reads as the system shouting. */
  .system-notice { margin: 0; color: var(--calm-ink-muted); }
  .system-notice-lead { color: var(--calm-danger); font-weight: 500; }
  .queued-messages { max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: 8px; margin: 0 0 var(--calm-turn-gap); padding: 0; border: 0; border-radius: 0; background: none; color: var(--calm-ink-dim); overflow: hidden; }
  .queued-heading { min-width: 0; display: grid; gap: 2px; }
  .queued-heading strong { color: var(--calm-ink-muted); font-weight: 500; }
  .queued-heading small { color: var(--calm-ink-dim); }
  /* A queued message is the bubble it is about to become, not yet sent: the
     same shape on the same side of the column, dimmed, with a dashed edge for
     "not committed". It needs no heading, count, or badge, because the reader
     is looking at the message itself sitting where it will land. */
  .queued-ghosts { max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: 8px; margin: 0 0 var(--calm-turn-gap); color: var(--calm-ink-muted); }
  .queued-ghost {
    --calm-bleed: 0px;
    width: fit-content;
    max-width: min(100%, 30rem);
    min-width: 0;
    box-sizing: border-box;
    margin-inline-start: auto;
    border: 1px dashed var(--pi-border);
    border-radius: var(--pi-radius-surface);
    background: color-mix(in srgb, var(--calm-canvas-soft) 55%, transparent);
    padding: 12px 16px;
    font-size: var(--pi-text-md);
  }
  /* State and action ride in the slot a sent message uses for its timestamp,
     so neither interrupts the message's own line. */
  .queued-ghost-meta { display: flex; justify-content: flex-end; align-items: baseline; gap: 10px; margin: 0; color: var(--calm-ink-dim); font-size: var(--pi-text-xs); }
  .queued-ghost-clear { padding: 0; border: 0; background: none; color: inherit; font: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
  .queued-ghost-clear:hover, .queued-ghost-clear:focus-visible { color: var(--pi-text-bright); }
  .queued-message { display: grid; gap: 4px; padding-top: 8px; border-top: 1px solid var(--pi-border); }
  .queued-message:first-of-type { padding-top: 0; border-top: 0; }
  .queued-kind { color: var(--pi-muted); font-size: var(--pi-text-sm); text-transform: uppercase; }
  .queued-command { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
  .queued-command-rest { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .pending-session-launch-recovery { margin: 0 0 var(--calm-turn-gap); }
  .session-launch-recovery { display: grid; gap: 5px; padding-top: 8px; border-top: 1px solid var(--pi-warning-border); }
  .session-launch-recovery strong { color: var(--pi-warning); font-weight: 600; }
  .session-launch-recovery p { margin: 0; color: var(--calm-ink-dim); }
  .session-launch-recovery-actions { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 3px; }
  .session-launch-recovery-actions button { border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-pill); background: var(--pi-surface); color: var(--pi-warning); padding: 5px 10px; font: var(--pi-text-sm) system-ui, sans-serif; white-space: nowrap; cursor: pointer; }
  .session-launch-recovery-actions button:hover, .session-launch-recovery-actions button:focus { border-color: var(--pi-warning); color: var(--pi-text-bright); }
  .session-launch-recovery-actions button:disabled { border-color: var(--pi-border); color: var(--pi-muted); cursor: default; opacity: .7; }
  .queued-dialogs { margin: -8px 0 14px; padding: 0 4px; color: var(--pi-muted); font-size: var(--pi-text-sm); text-align: center; }
  .history-boundary small { color: var(--pi-dim); }
  /* The liveness line is the running turn's footer, so it sits with the pooled
     activity above it rather than floating between them. */
  transcript-liveness { display: block; margin: -6px 0 var(--calm-turn-gap); }
  /* A turn's pooled activity closes that turn, so it sits tight under the prose
     it belongs to and keeps the full gap below to open the next turn. While the
     turn runs, the liveness line joins it as one footer. */

  /* No sticky header band. The row survives only to carry the role label, and
     collapses to nothing on the roles that hide it. */
  .msg-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 18px; margin-bottom: 2px; }
  /* On the two roles whose label is hidden the row holds nothing, so it
     collapses to zero height instead of reserving a band of its own. */
  .msg.user > .msg-header, .msg.assistant > .msg-header { height: 0; min-height: 0; margin: 0; overflow: visible; }
  /* Weight and position identify the speaker, so the role label is noise on
     the two roles that dominate the transcript. It is kept everywhere else,
     where it names something the reader cannot infer. */
  .msg.user > .msg-header .label, .msg.assistant > .msg-header .label { display: none; }
  .msg.tool > .msg-header .label, .msg.bash > .msg-header .label, .msg.skill > .msg-header .label, .msg.system > .msg-header .label, .msg.tool-image-output > .msg-header .label, .group-msg > .msg-header .label { color: var(--calm-ink-dim); }
  .label { display: block; color: var(--calm-ink-dim); font-size: var(--pi-text-xs); letter-spacing: .09em; text-transform: uppercase; }
  .msg-header .label { margin: 0; }
  .msg-meta { min-width: 0; opacity: .28; border: 0; background: transparent; color: var(--pi-dim); padding: 0; font: var(--pi-text-xs) system-ui, sans-serif; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity var(--pi-motion-fast) ease; cursor: pointer; user-select: text; -webkit-user-select: text; }
  .msg-meta:focus, .msg-meta.expanded { opacity: 1; }
  .msg-meta.expanded { flex: 1 1 auto; max-width: 100%; white-space: normal; overflow: visible; overflow-wrap: anywhere; text-overflow: clip; }
  .msg-meta:focus { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 3px; border-radius: var(--pi-radius-inline); }
  @media (hover: none) {
    .msg-meta { opacity: .75; max-width: 26px; }
    .msg-meta:not(.expanded) { display: inline-grid; width: 26px; height: 22px; place-items: center; font-size: 0; text-overflow: clip; }
    .msg-meta::before { content: "ⓘ"; font-size: var(--pi-text-sm); }
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
  .skill-invocation { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-surface); padding: 8px 10px; }
  /* An expandable disclosure is interactive, not a status: accent, not purple. */
  .skill-invocation > summary { color: var(--pi-accent); }
  .skill-invocation > small { display: block; margin: 6px 0 0; color: var(--pi-muted); }
  /* A skill read sits inside the fold with the other steps, so it takes the
     fold's voice: one dim line naming the skill, with the path underneath in
     the same tone. No card -- the fold must not reintroduce the texture the
     transcript drops. */
  .skill-read { padding: 0; border: 0; border-radius: 0; background: none; }
  .skill-read > strong { color: var(--calm-ink-muted); font-weight: 500; }
  .skill-read > small { display: block; margin: 2px 0 0; color: var(--calm-ink-dim); overflow-wrap: anywhere; }
  summary { cursor: pointer; color: var(--pi-muted); }
  pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; direction: ltr; text-align: left; unicode-bidi: isolate; }
  /* Shell output keeps monospace because it carries meaning, and a hairline
     instead of the success-coloured card it used to sit in. */
  .shell-output { padding-left: 12px; border-left: 1px solid var(--calm-rule); color: var(--calm-ink-dim); font: var(--pi-text-sm) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; direction: ltr; text-align: left; unicode-bidi: isolate; }
  /* A process notification is one of the turn's steps, so it reads like the
     others: a quiet name line, then what happened. The card it used to carry
     spent a border, a fill, and a role label on every event, which buried a run
     of five under one process in a screenful of chrome.

     Colour survives only on the failure's name, because a process that died is
     the one thing here that needs attention. */
  .process-notification { padding: 0; border: 0; border-radius: 0; background: none; }
  .process-notification-header { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; line-height: 1.4; }
  .process-notification-header .status-affordance { flex: 0 0 auto; font-size: var(--pi-text-sm); }
  .process-notification-header strong { flex: 0 0 auto; color: var(--calm-ink-muted); font-weight: 500; }
  .process-notification.error .process-notification-header strong,
  .process-notification.error .process-notification-header .status-affordance { color: var(--calm-danger); }
  .process-notification.success .process-notification-header .status-affordance { color: var(--pi-success); }
  .process-notification-header .summary { flex: 1 1 100%; min-width: 0; color: var(--calm-ink-dim); font-weight: normal; overflow-wrap: anywhere; }
  .process-notification-header .exit-code { flex: 0 0 auto; color: var(--calm-ink-dim); font-size: var(--pi-text-sm); font-family: var(--pi-mono, ui-monospace, monospace); }
  .process-notification .raw-disclosure { margin-top: 4px; }
  .process-notification .raw-disclosure summary { cursor: pointer; color: var(--pi-muted); font-size: var(--pi-text-sm); }
  .process-notification .raw-content { margin: 6px 0 0; padding: 8px; max-height: 180px; overflow: auto; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-control); background: var(--pi-bg); color: var(--pi-text); font: var(--pi-text-xs) var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
`;

/** The liveness line at the foot of a running turn. */
export const transcriptLivenessStyles = css`
  :host { display: block; }
  .liveness-block { display: grid; gap: 2px; min-width: 0; }
  .liveness { display: flex; align-items: baseline; gap: 8px; min-width: 0; margin: 0; color: var(--calm-ink-dim); font-size: var(--pi-text-sm); }
  /* The step is a glance; the fold holds the full text. */
  .liveness span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .liveness-dot { flex: 0 0 auto; align-self: center; width: 7px; height: 7px; border-radius: 50%; background: var(--pi-accent); }
  .stuck { display: flex; align-items: baseline; gap: 8px; min-width: 0; margin: 0 0 0 15px; color: var(--pi-muted); font-size: var(--pi-text-sm); }
  .stuck span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stop { flex: 0 0 auto; border: 0; background: none; color: var(--calm-ink-dim); padding: 0; font: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
  .stop:hover, .stop:focus-visible { color: var(--calm-danger); }
  @media (prefers-reduced-motion: no-preference) {
    .liveness-dot { animation: transcript-liveness-pulse 1.8s ease-in-out infinite; }
  }
  @keyframes transcript-liveness-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
`;

export const formattedTextStyles = css`
  :host { display: block; }
  .formatted { white-space: normal; overflow-wrap: anywhere; line-height: 1.55; text-align: start; unicode-bidi: plaintext; }
  p, ul, ol, pre, blockquote, .table-scroll { margin: 0 0 10px; }
  :is(p, ul, ol, pre, blockquote, .table-scroll):last-child { margin-bottom: 0; }
  ul, ol { padding-left: 22px; }
  li + li { margin-top: 3px; }
  /* A path long enough to wrap gets a whole chip on each line. Without the
     clone the border opens at the break and closes on the next line, which
     reads as one broken box rather than one value continued. */
  code { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-inline); background: var(--pi-bg); padding: 1px 4px; font: var(--pi-text-sm) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; direction: ltr; text-align: left; unicode-bidi: isolate; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  pre { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-bg); padding: 10px; overflow-x: auto; overflow-y: hidden; direction: ltr; text-align: left; unicode-bidi: isolate; }
  pre code { border: 0; padding: 0; background: transparent; }
  .hljs-comment, .hljs-code, .hljs-formula { color: var(--pi-muted); font-style: italic; }
  .hljs-doctag, .hljs-keyword, .hljs-template-tag, .hljs-template-variable, .hljs-type, .hljs-variable.language_ { color: var(--pi-purple); }
  .hljs-title, .hljs-title.class_, .hljs-title.class_.inherited__, .hljs-title.function_, .hljs-section { color: var(--pi-accent); }
  .hljs-attr, .hljs-attribute, .hljs-literal, .hljs-meta, .hljs-number, .hljs-operator, .hljs-variable, .hljs-selector-attr, .hljs-selector-class, .hljs-selector-id { color: var(--pi-warning); }
  .hljs-regexp, .hljs-string, .hljs-meta .hljs-string, .hljs-addition { color: var(--pi-success); }
  .hljs-built_in, .hljs-symbol, .hljs-name, .hljs-quote, .hljs-selector-tag, .hljs-selector-pseudo, .hljs-deletion { color: var(--pi-danger); }
  .hljs-section, .hljs-strong { font-weight: 600; }
  .hljs-emphasis { font-style: italic; }
  .hljs-addition { background: color-mix(in srgb, var(--pi-success) 12%, transparent); }
  .hljs-deletion { background: color-mix(in srgb, var(--pi-danger) 12%, transparent); }
  /* Content that is not prose takes the whole content column. It keeps the
     column's start edge -- it is the prose beside it that is narrow, not this
     that is offset -- and grows to the right into space the column already
     owns. No negative margins: a later margin shorthand used to reset them and
     silently undo the widening.

     A feature takes what it needs, not what it may have: fit-content bounded by
     the bleed, so a narrow table stays inside the column and produces no ragged
     edge at all, and a wide one sticks out exactly as far as its content asks.

     Only a top-level pre widens: one nested inside a list item belongs to the
     prose around it. Where the bleed is unknown (outside the transcript) or
     deliberately withheld (inside a message bubble), the fallback keeps these
     inside their parent. */
  .table-scroll, .formatted > pre { inline-size: fit-content; max-inline-size: calc(100% + var(--calm-bleed, 0px)); }
  blockquote { border-left: 3px solid var(--pi-border); padding-left: 10px; color: var(--pi-muted); }
  a { color: var(--pi-accent); }
  /* A heading belongs to what follows it, so it sits far from the paragraph
     above and close to the one below. Equal space on both sides leaves it
     floating between two blocks and belonging to neither. Close, but not
     touching: at 6px the heading crowded its own first line. */
  h1, h2, h3, h4 { margin: 28px 0 10px; line-height: 1.25; }
  h1:first-child, h2:first-child, h3:first-child, h4:first-child { margin-top: 0; }
  h1 { font-size: 20px; }
  h2 { font-size: var(--pi-text-lg); }
  h3 { font-size: var(--pi-text-md); }
  h4 { font-size: var(--pi-text-md); }
  .table-scroll { overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
  .table-scroll:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px; }
  table { border-collapse: collapse; width: max-content; min-width: 100%; max-width: none; }
  /* A table is reference, not prose. One step down from the reading size buys
     about a column of width before anything has to give, and a table is read by
     scanning rather than by the line. */
  th, td { border: 1px solid var(--pi-border); padding: 4px 8px; max-width: 48ch; overflow-wrap: anywhere; font-size: var(--pi-text-sm); }
  th { background: var(--pi-surface); }

  /* A table too wide for the column is read as records instead.

     Scrolling a table sideways inside a transcript costs the reader the first
     column as soon as they reach the last one, and on a touch screen the
     gesture fights the transcript. Read as records, every value stays reachable
     and carries the heading it belongs to. What is lost is comparison down a
     column: that is the trade, and it is only taken when the table does not
     fit. formatting/tableReflow.ts decides, from width alone. */
  .table-scroll.stacked { inline-size: 100%; max-inline-size: 100%; overflow-x: visible; container-type: inline-size; }
  .table-scroll.stacked table { display: block; inline-size: 100%; min-inline-size: 0; }
  /* The heading row is in every cell now, so the original is noise. */
  .table-scroll.stacked thead { display: none; }
  /* One grid for the whole table, borrowed by every record and every field, so
     a single heading track serves all of them and the values line up down the
     table. A grid per record measures only its own headings and leaves each
     record's values at a different place, which reads as three lists that
     happen to be stacked rather than one table.

     The heading track is as wide as the headings need and no wider than a third
     of the table, so a long heading wraps rather than starving the value.
     fit-content() takes a percentage; min() does not take max-content, and
     spelling it that way drops the declaration and puts every heading on its
     own line.

     Hairlines above and below, and one between records -- the same grammar the
     transcript uses for its other non-prose blocks. A box per record drew three
     panels that looked unrelated to each other and to the sentence that
     introduced them. */
  .table-scroll.stacked tbody { display: grid; grid-template-columns: fit-content(32%) minmax(0, 1fr); column-gap: 14px; border-block: 1px solid var(--calm-rule, var(--pi-border)); }
  .table-scroll.stacked tr { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; row-gap: 3px; padding-block: 9px; }
  .table-scroll.stacked tr + tr { border-top: 1px solid var(--calm-rule, var(--pi-border)); }
  /* A record is read at the reading size.

     A table steps down to --pi-text-sm to buy width. A stacked table has no
     columns left to buy width for -- it is a list of statements -- so the step
     bought nothing and cost the heading, which sat one step further down at the
     bottom of the ramp: 11px and muted, under the value it is there to name.

     The value returns to the prose size and the heading sits one step under it,
     as large as a heading may be without out-shouting what it names. The cost is
     height: bigger type wraps sooner, so a stacked table is taller than it was. */
  .table-scroll.stacked td { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: baseline; border: 0; padding: 0; max-width: none; font-size: var(--pi-text-md); }
  .table-scroll.stacked td::before { content: attr(data-label); color: var(--pi-muted); font-size: var(--pi-text-sm); line-height: 1.5; }
  .table-scroll.stacked .cell-value { min-inline-size: 0; }
  /* The first column names the record: repeating its heading on every record
     says the same word three times and buries the name in the list of fields.
     It reads as a title instead, and the heading it drops is written once above
     the table. */
  .table-scroll.stacked td:first-child { display: block; grid-column: 1 / -1; margin-block-end: 3px; font-size: var(--pi-text-md); font-weight: 600; }
  .table-scroll.stacked td:first-child::before { content: none; }
  .table-scroll.stacked tbody::before { content: attr(data-record-label); grid-column: 1 / -1; padding-block-start: 8px; color: var(--pi-muted); font-size: var(--pi-text-xs); letter-spacing: .08em; text-transform: uppercase; }
  .table-scroll.stacked tbody:not([data-record-label])::before { content: none; }
  /* A cell with nothing in it says nothing worth a line. */
  .table-scroll.stacked td:empty { display: none; }
  /* A cell past the end of the heading row has no heading to show. */
  .table-scroll.stacked td:not([data-label]) { display: block; }
  .table-scroll.stacked td:not([data-label])::before { content: none; }
  /* Too narrow for two tracks: a heading that takes a third of the width leaves
     the value a stub. The heading moves above its value, and the record's own
     grid is what decides -- the table is asked how much room it has, never what
     is showing it. */
  @container (max-width: 26rem) {
    .table-scroll.stacked tbody { grid-template-columns: minmax(0, 1fr); }
    .table-scroll.stacked td { row-gap: 0; }
  }
`;

export const autocompleteStyles = css`
  ${commandMarkStyles}
  :host { display: block; }
  .menu {
    position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); z-index: 10;
    max-height: var(--composer-completion-menu-max-block-size, 260px);
    max-block-size: var(--composer-completion-menu-max-block-size, 260px);
    overflow: auto; overscroll-behavior: contain;
    border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-surface); box-shadow: 0 10px 30px var(--pi-shadow);
  }
  button { display: grid; grid-template-columns: minmax(120px, 1fr) auto; gap: 4px 10px; width: 100%; border: 0; border-bottom: 1px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-text); padding: 8px 10px; text-align: left; cursor: pointer; }
  button:last-child { border-bottom: 0; }
  button.selected, button:hover { background: var(--pi-selection-bg); }
  button:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: -2px; }
  span { color: var(--pi-muted); font-size: var(--pi-text-sm); }
  small { grid-column: 1 / -1; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The mark hugs its text; the grid cell must not stretch it into a bar. */
  button .command-mark { justify-self: start; }
`;

export const promptEditorStyles = css`
  ${composerDraftStyles}
  /*
   * The composer is one island: an inset surface the transcript runs up to,
   * rather than a stack of full-width bands. Everything it needs — the context
   * reading, the draft, one control rail — lives inside that single border, so
   * a new capability has to earn its place on the rail instead of adding a row.
   * It is its own container: nothing here keys off the viewport.
   */
  :host { position: relative; z-index: 5; display: block; container-type: inline-size; color: var(--pi-text); font: var(--pi-text-md) system-ui, sans-serif; }
  /*
   * The island is placed by where its text starts, not by where its box starts.
   * A reader tracks one vertical line down the transcript and into the caret,
   * so the draft takes the content column and the box around it grows outwards
   * by its own chrome -- border, padding, and the draft's border and padding --
   * each read from the property that draws it, so changing a padding moves the
   * alignment with it and no number is written twice.
   *
   * The island's gap from the shell edge is the leftover: the column's gutter
   * less the chrome that hangs into it. It is not chosen here, so the gap and
   * the alignment cannot disagree.
   */
  footer {
    --composer-island-edge: 1px;
    --composer-island-radius: var(--pi-radius-surface);
    --composer-island-pad: 10px;
    --composer-text-inset: calc(var(--composer-island-edge) + var(--composer-island-pad) + var(--composer-draft-edge) + var(--composer-draft-pad));
    position: relative;
    box-sizing: border-box;
    inline-size: min(100%, var(--calm-measure) + 2 * var(--composer-text-inset));
    display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px;
    margin: 0 auto max(8px, env(safe-area-inset-bottom));
    padding: var(--composer-island-pad);
    overflow: visible;
    border: var(--composer-island-edge) solid var(--pi-border);
    border-radius: var(--composer-island-radius);
    background: var(--pi-bg);
    box-shadow: 0 6px 18px var(--pi-shadow);
  }
  /* Context use is the island's own top edge — one reading on a line the eye
     already crosses, instead of a band of its own. It is held to the straight
     run between the corners: a square-ended bar cannot follow the curve, and
     clipping the island to make it fit would trap the choice popovers. */
  context-usage-meter { position: absolute; top: 0; inset-inline: var(--composer-island-radius); }
  footer.shell-mode { border-color: var(--pi-success); background: var(--pi-success-bg); }
  .actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: nowrap; white-space: nowrap; }
  :host([surface="embedded"]) footer {
    inline-size: 100%;
    margin-inline: 0;
    box-shadow: none;
  }
  :host([surface="embedded"]) .actions { justify-content: flex-start; }
  .compact-status { display: flex; min-width: 0; align-items: center; gap: 6px; color: var(--pi-muted); font-size: var(--pi-text-sm); flex: 1 1 0; }
  .model-capsule { flex: 0 1 auto; display: inline-flex; align-items: center; min-width: 0; overflow: hidden; }
  .model-capsule .select-model { box-sizing: border-box; height: 36px; max-width: min(64cqi, 460px); border-start-end-radius: 0; border-end-end-radius: 0; min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* When the capsule runs out of room the name gives way, never the gauge. The
     name is still readable when shortened; a clipped gauge is a control the
     hand cannot reach, and a truncated model name is not. */
  .model-capsule .select-thinking { width: auto; min-width: 34px; flex: 0 0 auto; margin-inline-start: -1px; padding-inline: 6px; border-start-start-radius: 0; border-end-start-radius: 0; }
  /* The gauge carries the level; the word joins it only where the rail has room. */
  @container (min-width: 560px) {
  }
  /*
   * The rail has one row and a fixed order of importance: direct actions,
   * runtime status, the primary action, and stop always fit. Session identity
   * appears only when the island's own width can carry it.
   */
  .composer-context-chip { display: none; align-items: center; gap: 4px; }
  /* An actionable chip keeps its control at every width. Its readout yields
     until the rail has room, because information must give way before a control. */
  .composer-context-chip.actionable { display: inline-flex; flex: 0 0 auto; overflow: visible; }
  .composer-context-chip.actionable .context-chip-name { display: none; }
  /* A chip states where the composer points; its action is a quiet icon, not
     a second text label competing with the row's real controls. The mark draws
     at 28px, while the pseudo-element restores the rail's 36px hit target. */
  .composer-context-chip-action { position: relative; flex: 0 0 auto; width: 28px; height: 28px; display: inline-grid; place-items: center; padding: 0; border: 0; border-radius: var(--pi-radius-control); background: transparent; color: var(--pi-accent); cursor: pointer; }
  .composer-context-chip-action::after { content: ""; position: absolute; inset: -4px; }
  .composer-context-chip-action:hover:not(:disabled), .composer-context-chip-action:focus-visible { background: var(--pi-surface-hover); color: var(--pi-text); }
  .composer-context-chip-action:disabled { color: var(--pi-muted); cursor: default; }
  .prompt-context-action-icon { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .context-chip-name { min-width: 0; max-width: min(26cqi, 168px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prompt-branch-icon { flex: 0 0 auto; width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .session-identity { display: none; flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--pi-text-secondary); }
  @container (min-width: 560px) {
    .session-identity { display: inline; }
    .composer-context-chip { display: inline-flex; }
    .composer-context-chip.actionable .context-chip-name { display: inline; }
  }
  /*
   * The rail carries one filled control: the primary action. Everything else
   * on it is a quiet ghost -- no border, no fill -- so the row reads as one
   * instrument with a single obvious trigger instead of eight equal chips.
   */
  .icon-button { flex: 0 0 auto; display: inline-grid; place-items: center; width: 36px; height: 36px; padding: 0; border-color: transparent; background: transparent; color: var(--pi-muted); }
  .icon-button:hover:not(:disabled), .icon-button:focus-visible { background: var(--pi-surface-hover); color: var(--pi-text); }
  .dictation-button { touch-action: none; user-select: none; -webkit-user-select: none; }
  .dictation-button[aria-pressed="true"] { border-color: var(--pi-accent); background: var(--pi-selection-bg); color: var(--pi-accent); }
  .rapidfire-button[aria-pressed="true"] { border-color: var(--pi-accent); background: var(--pi-selection-bg); color: var(--pi-accent); }
  .rapidfire-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .dictation-held[aria-pressed="true"], .dictation-manual-only[aria-pressed="true"] { border-color: var(--pi-warning-border, var(--pi-accent)); color: var(--pi-warning); }
  .dictation-transcribing { color: var(--pi-accent); }
  .dictation-status { flex: 1 1 8rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); font-size: var(--pi-text-sm); text-align: right; }
  /*
   * Dictation reports from inside the draft box.
   *
   * It has already locked that box, so the space is taken and unused. A strip
   * above the composer would spend 40px of height on an island that is 110px
   * tall on a folded phone, and would duplicate a reserved surface. One signal
   * per fact: the border says the box is not the reader's to type in, the
   * waveform says audio is arriving, the number says it is still happening.
   */
  .markdown-editor .cm-editor.dictation-live { border-color: var(--pi-accent-border); transition: border-color var(--pi-motion-fast) ease-out; }
  /* The readout stands in for the draft's first line, so the placeholder it
     replaces must not show through behind the waveform. */
  .markdown-editor .cm-editor.dictation-live .cm-placeholder { visibility: hidden; }
  /* A draft with words in it keeps them: the readout drops to the foot of the
     box and the text is given room above it rather than being covered. */
  .markdown-editor .cm-editor.dictation-live.dictation-over-text .cm-content { padding-bottom: 30px; }
  .dictation-readout.dictation-over-text { align-items: flex-end; padding-bottom: 6px; }
  .dictation-readout { position: absolute; inset: 0; display: flex; align-items: center; gap: var(--pi-space-md); padding: 0 var(--pi-space-md); overflow: hidden; font: var(--pi-control-font-size, 16px)/1.4 var(--pi-control-font-family, system-ui, sans-serif); color: var(--pi-text-secondary); pointer-events: none; }
  .dictation-readout > * { pointer-events: auto; }
  /* Only states that need explaining carry words: a live waveform beside a
     running clock says listening on its own, and the microphone below it is
     the control that ends the turn. */
  /* The word keeps its width and the waveform gives ground: a state truncated
     to "Tran..." costs the reader the one fact the drawing cannot carry. A
     stated failure is all words, so there it may truncate. */
  .dictation-readout .dictation-words { flex: 0 0 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: -0.01em; }
  .dictation-readout.dictation-stated .dictation-words { flex: 0 1 auto; }
  /* The working state is marked, not labelled: written lines beside the
      waveform of the audio they are being made from. It costs 18px where the
      word cost about a hundred, which is waveform on a folded phone. */
  .dictation-readout .dictation-mark { flex: 0 0 auto; display: inline-grid; place-items: center; width: 18px; height: 18px; color: var(--pi-text-secondary); }
  .dictation-readout .dictation-mark .prompt-action-icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .dictation-readout.dictation-stated { justify-content: center; }
  /*
   * The waveform is measured, not decorative: one bar per 50ms batch, height
   * from the RMS the capture worklet already computes for its own voicing
   * decision. It takes the width, so the whole turn stays legible.
   */
  .dictation-readout .dictation-wave { position: relative; flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 2px; height: 20px; overflow: hidden; }
  .dictation-readout .dictation-wave::before { content: ""; position: absolute; inset-inline: 0; top: 50%; height: 1px; background: var(--pi-border-muted); }
  .dictation-readout .dictation-wave i { position: relative; flex: 0 0 auto; width: 2px; min-height: 2px; border-radius: 1px; background: var(--pi-accent); transition: height var(--pi-motion-fast) ease-out; }
  .dictation-readout .dictation-wave i.quiet { background: var(--pi-border); }
  /* Working, not live: the audio is with the gateway now. The sweep travels at
     a constant rate and maps to nothing, because no progress is reported. */
  .dictation-readout.dictation-working .dictation-wave { opacity: .55; }
  .dictation-readout.dictation-working .dictation-wave::after { content: ""; position: absolute; inset-block: 0; inset-inline-start: 0; width: 45%; background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--pi-accent) 18%, transparent) 50%, transparent 100%); animation: dictation-sweep 1.8s ease-in-out infinite; }
  @keyframes dictation-sweep { from { transform: translateX(-100%); } to { transform: translateX(322%); } }
  @media (prefers-reduced-motion: reduce) {
    .dictation-readout .dictation-wave i { transition: none; }
    .dictation-readout.dictation-working .dictation-wave::after { animation: none; opacity: .35; transform: none; }
  }
  /* The number is the proof that something is still happening, so it is the one
     thing here set in the reader's own ink. */
  .dictation-readout .dictation-clock { flex: 0 0 auto; color: var(--pi-text); font-variant-numeric: tabular-nums; }
  /* Capability, so it never yields: the only way to abandon a transcription
     that would otherwise hold the draft for its full deadline. Drawn as a word,
     hit as a full touch target, taken back out of the line's height. */
  .dictation-readout .dictation-cancel { flex: 0 0 auto; min-height: 44px; padding: 0 4px; margin-block: -13px; border: 0; background: none; color: var(--pi-muted); font: inherit; font-size: var(--pi-text-sm); cursor: pointer; }
  .dictation-readout .dictation-cancel:hover, .dictation-readout .dictation-cancel:focus-visible { color: var(--pi-text); }
  .dictation-privacy { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
  .dictation-retry-actions { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; }
  .dictation-retry-actions button { min-height: 28px; padding: 4px 7px; font-size: var(--pi-text-sm); }
  .dictation-acquiring[aria-pressed="true"], .dictation-auto[aria-pressed="true"], .dictation-checking[aria-pressed="true"] { box-shadow: 0 0 0 2px color-mix(in srgb, var(--pi-accent) 18%, transparent); }
  .composer-archive { color: var(--pi-muted); }
  @container (min-width: 700px) {
  }
  .composer-archive:hover, .composer-archive:focus-visible { color: var(--pi-text-bright); background: var(--pi-surface-hover); }
  .primary-action { flex: 0 0 auto; display: inline-flex; align-items: center; }
  .queue-button { position: relative; touch-action: manipulation; -webkit-touch-callout: none; }
  .queue-steer-cue { position: absolute; inset-block-start: 2px; inset-inline-end: 4px; font: 700 10px/1 system-ui, sans-serif; color: currentColor; opacity: .72; pointer-events: none; }
  .steer-confirmation { padding: 8px; }
  .steer-confirm-button { min-width: 180px; text-align: start; }
  .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important; }
  .icon-button .prompt-action-icon, .icon-button .prompt-thinking-gauge, .icon-button .new-session-icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .icon-button .prompt-action-icon-filled { fill: currentColor; stroke: none; }
  .send-button:not(:disabled) { border-color: var(--pi-accent-border, var(--pi-accent)); background: var(--pi-accent); color: var(--pi-bg); }
  .send-button:hover:not(:disabled), .send-button:focus-visible:not(:disabled) { background: var(--pi-accent); color: var(--pi-bg); }
  .stop-button:not(:disabled) { color: var(--pi-danger); }
  .stop-button:hover:not(:disabled), .stop-button:focus-visible:not(:disabled) { background: color-mix(in srgb, var(--pi-danger) 12%, transparent); color: var(--pi-danger); }
  .select-thinking .prompt-thinking-gauge .gauge-bar { fill: currentColor; stroke: none; opacity: .28; }
  .select-thinking .prompt-thinking-gauge .gauge-bar-active { opacity: 1; }
  /* At rest the draft stands down so the transcript keeps the space. */
  button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  @container (max-width: 640px) {
    footer { gap: 8px; --composer-island-pad: 8px; }
    .actions { gap: 6px; }
    .compact-status { flex: 1 1 220px; gap: 4px; }
    .select-model { max-width: min(62cqi, 320px); }
    button { padding: 6px 8px; }
  }
  @container (max-width: 430px) {
    .compact-status { flex-basis: 170px; font-size: var(--pi-text-xs); }
    .select-model { max-width: 56cqi; }
    button { padding: 5px 7px; }
  }
`;
