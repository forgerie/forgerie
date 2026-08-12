import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { toSafeMarkdownHtml } from "../formatting/markdown";
import { formattedTextStyles } from "./shared";

@customElement("formatted-text")
export class FormattedText extends LitElement {
  @property() text = "";

  override render() {
    return html`<div class="formatted" dir="auto">${unsafeHTML(toSafeMarkdownHtml(this.text))}</div>`;
  }

  static override styles = formattedTextStyles;
}
