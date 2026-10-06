import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { codemodeExecution, formatCodemodeCost, formatCodemodeDuration, type CodemodeCall, type CodemodeCallStatus, type CodemodeExecution } from "../codemodeExecution";
import { highlightedCodeHtml } from "../formatting/markdown";
import { codeTokenStyles, type ToolExecutionPart } from "./shared";

/** Lines of script shown before "Show all": enough for a script's opening comment and first calls. */
const COLLAPSED_SCRIPT_LINES = 8;

/**
 * The body of a `codemode` step: the script, the calls it made, and what it printed.
 *
 * In the order the run happened, so a reader follows it top to bottom. The
 * calls are a trace rather than tool cards, because a script's calls never
 * become transcript entries: Pi keeps their name, arguments, status, and
 * timing, not their results. Images the script showed render beside the step
 * like any tool's images.
 */
@customElement("codemode-execution-view")
export class CodemodeExecutionView extends LitElement {
  @property({ attribute: false }) execution: ToolExecutionPart | undefined;
  @state() private showFullScript = false;

  override render() {
    const execution = this.execution;
    if (execution === undefined) return null;
    const view = codemodeExecution(execution);
    const failed = execution.status === "error";
    return html`
      <div class="codemode">
        ${this.renderScript(view.script)}
        ${view.calls.length === 0 ? null : html`
          <section class="section" aria-label="Calls">
            <span class="label">${callCountLabel(view.calls.length)}</span>
            <ol class="calls">${view.calls.map((call) => renderCall(call))}</ol>
          </section>
        `}
        ${view.output === "" ? null : html`
          <section class="section" aria-label="Output">
            <span class="label">Output</span>
            <pre class=${failed && view.scriptError === undefined ? "output failed" : "output"}>${view.output}</pre>
          </section>
        `}
        ${view.scriptError === undefined ? null : html`
          <section class="section" aria-label="Script error">
            <span class="label">Script error</span>
            <pre class="output failed">${view.scriptError}</pre>
          </section>
        `}
        ${renderFacts(view)}
      </div>
    `;
  }

  private renderScript(script: string) {
    if (script === "") return null;
    const lines = script.replace(/\s+$/u, "").split("\n");
    const collapsed = !this.showFullScript && lines.length > COLLAPSED_SCRIPT_LINES;
    const shown = collapsed ? lines.slice(0, COLLAPSED_SCRIPT_LINES).join("\n") : lines.join("\n");
    return html`
      <section class="section" aria-label="Script">
        <span class="label">Script</span>
        <pre class="script"><code class="hljs language-javascript">${unsafeHTML(highlightedCodeHtml("javascript", shown))}</code></pre>
        ${collapsed ? html`
          <button class="show-more" type="button" @click=${() => { this.showFullScript = true; }}>
            Show all ${String(lines.length)} lines
          </button>
        ` : null}
      </section>
    `;
  }

  static override styles = [codeTokenStyles, css`
    /* The same quiet register as other step details: no panel, no fill.
       Only failure keeps a tone, because failure is worth a glance. */
    :host { display: block; min-width: 0; color: var(--calm-ink-dim); }
    .codemode { display: grid; gap: 12px; min-width: 0; }
    .section { display: grid; gap: 4px; min-width: 0; }
    .label { color: var(--pi-muted); font-size: var(--pi-text-sm); text-transform: uppercase; letter-spacing: .04em; }
    pre { box-sizing: border-box; max-width: 100%; margin: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; white-space: pre; font: var(--pi-text-sm) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; direction: ltr; text-align: left; unicode-bidi: isolate; }
    /* The script is code the agent wrote, so it gets the code well the chat
       uses for fenced code; the output is the result, read in place. */
    .script { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-control); background: var(--pi-bg); padding: 8px 10px; color: var(--calm-ink-muted); }
    .output { color: var(--calm-ink-dim); }
    .output.failed { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--calm-danger); }
    .calls { display: grid; margin: 0; padding: 0; list-style: none; }
    /* Name and target share one wrapping cell: a long command reads in full
       on a narrow screen instead of hiding behind an ellipsis. */
    .call { display: grid; grid-template-columns: 1.2em minmax(0, 1fr) auto; column-gap: 6px; align-items: baseline; padding: 3px 0; border-bottom: 1px solid var(--pi-border-muted); font-size: var(--pi-text-sm); }
    .call:last-child { border-bottom: 0; }
    .glyph { color: var(--pi-muted); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
    .call.error .glyph, .call-error { color: var(--calm-danger); }
    .call-text { min-width: 0; overflow-wrap: anywhere; }
    .call-name { color: var(--calm-ink-muted); font-weight: 500; }
    .call-target { color: var(--pi-accent); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; direction: ltr; unicode-bidi: isolate; }
    .call-meta { display: inline-flex; gap: 8px; color: var(--pi-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .call-error { grid-column: 2 / -1; margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: var(--pi-text-sm) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .facts { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0; color: var(--pi-muted); font-size: var(--pi-text-sm); }
    .facts code { overflow-wrap: anywhere; font: inherit; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    button { justify-self: start; border: 0; background: none; color: var(--calm-ink-dim); padding: 3px 0; font: var(--pi-text-sm) system-ui, sans-serif; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    button:hover, button:focus-visible { color: var(--calm-ink-muted); }
  `];
}

function renderCall(call: CodemodeCall) {
  return html`
    <li class=${`call ${call.status}`}>
      <span class="glyph" aria-hidden="true">${callGlyph(call.status)}</span>
      <span class="call-text">
        <span class="sr-only">${callStatusLabel(call.status)} </span>
        <span class="call-name">${call.name}</span>
        ${call.target === "" ? null : html` <span class="call-target">${call.target}</span>`}
      </span>
      <span class="call-meta">
        ${call.costUsd === undefined ? null : html`<span>${formatCodemodeCost(call.costUsd)}</span>`}
        ${call.durationMs === undefined ? null : html`<span>${formatCodemodeDuration(call.durationMs)}</span>`}
      </span>
      ${call.error === undefined ? null : html`<p class="call-error">${call.error}</p>`}
    </li>
  `;
}

function renderFacts(view: CodemodeExecution) {
  const facts = [
    ...(view.wallTimeSeconds === undefined ? [] : [html`<span>Ran in ${formatCodemodeDuration(view.wallTimeSeconds * 1000)}</span>`]),
    ...(view.modelCostUsd === undefined ? [] : [html`<span>Model calls ${formatCodemodeCost(view.modelCostUsd)}</span>`]),
    ...(view.fullOutputPath === undefined ? [] : [html`<span>Full output in <code>${view.fullOutputPath}</code></span>`]),
  ];
  return facts.length === 0 ? null : html`<p class="facts">${facts}</p>`;
}

function callCountLabel(count: number): string {
  return `${String(count)} ${count === 1 ? "call" : "calls"}`;
}

function callGlyph(status: CodemodeCallStatus): string {
  if (status === "ok") return "✓";
  if (status === "error") return "✗";
  if (status === "cancelled") return "⊘";
  return "●";
}

function callStatusLabel(status: CodemodeCallStatus): string {
  if (status === "ok") return "done";
  if (status === "error") return "failed";
  if (status === "cancelled") return "cancelled";
  return "running";
}

declare global {
  interface HTMLElementTagNameMap {
    "codemode-execution-view": CodemodeExecutionView;
  }
}
