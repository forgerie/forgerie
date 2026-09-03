import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { toSafeMarkdownHtml } from "../formatting/markdown";
import { fitTablesToColumn } from "../formatting/tableReflow";
import { formattedTextStyles } from "./shared";

@customElement("formatted-text")
export class FormattedText extends LitElement {
  @property() text = "";

  private columnResizeObserver: ResizeObserver | undefined;

  override render() {
    return html`<div class="formatted" dir="auto">${unsafeHTML(toSafeMarkdownHtml(this.text))}</div>`;
  }

  // Tables are judged against the width they were just given, so the decision is
  // remade after every render and after every resize of the column they sit in.
  override updated(): void {
    const column = this.shadowRoot?.querySelector(".formatted");
    if (column === null || column === undefined) return;
    this.observeColumn(column);
    if (column.querySelector("table") === null) return;
    fitTablesToColumn(column);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.columnResizeObserver?.disconnect();
    this.columnResizeObserver = undefined;
  }

  private observeColumn(column: Element): void {
    if (this.columnResizeObserver !== undefined || typeof ResizeObserver === "undefined") return;
    this.columnResizeObserver = new ResizeObserver(() => {
      if (column.querySelector("table") === null) return;
      fitTablesToColumn(column);
    });
    this.columnResizeObserver.observe(column);
  }

  static override styles = formattedTextStyles;
}
