import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { scrollWhenSelected } from "./scrollWhenSelected";
import { autocompleteStyles, type CompletionItem } from "./shared";

let autocompleteMenuSequence = 0;

@customElement("autocomplete-menu")
export class AutocompleteMenu extends LitElement {
  @property({ attribute: false }) items: CompletionItem[] = [];
  @property({ type: Number }) selectedIndex = 0;
  @property() listboxId = `autocomplete-listbox-${String(++autocompleteMenuSequence)}`;
  @property() optionIdPrefix = `${this.listboxId}-option-`;
  @property() label = "Completions";
  @property({ attribute: false }) onPick?: (item: CompletionItem) => void;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("listboxId") && !changed.has("optionIdPrefix")) this.optionIdPrefix = `${this.listboxId}-option-`;
  }

  override render() {
    if (!this.items.length) return null;
    return html`
      <div class="menu" id=${this.listboxId} role="listbox" aria-label=${this.label}>
        ${this.items.map((item, index) => {
          const selected = index === this.selectedIndex;
          return html`
            <button
              id=${`${this.optionIdPrefix}${String(index)}`}
              type="button"
              role="option"
              aria-selected=${selected ? "true" : "false"}
              tabindex="-1"
              data-completion-index=${String(index)}
              class=${selected ? "selected" : ""}
              ${scrollWhenSelected(selected, item)}
              @mousedown=${(event: MouseEvent) => { event.preventDefault(); this.onPick?.(item); }}
            >
              ${item.kind === "command"
                ? html`<strong class="command-mark"><span class="command-sigil">/</span><span class="command-name">${item.insertText.slice(1)}</span></strong>`
                : html`<strong>${item.insertText}</strong>`}
              <span>${item.detail}</span>
              ${item.description !== undefined && item.description !== "" ? html`<small>${item.description}</small>` : null}
            </button>
          `;
        })}
      </div>
    `;
  }

  static override styles = autocompleteStyles;
}
