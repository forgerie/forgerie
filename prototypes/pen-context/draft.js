/**
 * PROTOTYPE — the prompt draft.
 *
 * Every pen mark ends up here as one context item. The panel shows the prompt
 * that Forgerie would hand to the agent, so the mark-to-prompt translation is
 * visible while you are marking.
 */

const INTENT_LABEL = {
  include: "include",
  investigate: "look at",
  exclude: "ignore",
  relate: "relate",
  note: "note",
};

export class Draft {
  constructor(panel, options = {}) {
    this.panel = panel;
    this.items = [];
    this.note = "";
    this.image = undefined;
    this.options = options;
    this.render();
  }

  add(item) {
    this.items.push({ id: `item-${String(Date.now())}-${String(this.items.length)}`, ...item });
    this.render();
  }

  remove(id) {
    const removed = this.items.find((item) => item.id === id);
    this.items = this.items.filter((item) => item.id !== id);
    this.render();
    if (removed !== undefined) this.options.onRemove?.(removed);
  }

  setNote(value) {
    this.note = value;
    this.render();
  }

  setImage(dataUrl) {
    this.image = dataUrl;
    this.render();
  }

  clear() {
    this.items = [];
    this.note = "";
    this.image = undefined;
    this.render();
  }

  promptText() {
    if (this.items.length === 0 && this.note === "" && this.image === undefined) return "";
    const lines = [];
    if (this.note !== "") lines.push(this.note, "");
    if (this.items.length > 0) lines.push("Context I marked:");
    for (const item of this.items) {
      lines.push(`- ${INTENT_LABEL[item.intent]}: ${item.ref}${item.text === undefined ? "" : ` — ${item.text}`}`);
    }
    if (this.image !== undefined) lines.push("", "[marked-up image attached]");
    return lines.join("\n");
  }

  render() {
    const prompt = this.promptText();
    this.panel.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Prompt draft";
    this.panel.appendChild(heading);

    if (prompt === "") {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = this.options.emptyHint ?? "Mark something with the pen.";
      this.panel.appendChild(empty);
      return;
    }

    const chips = document.createElement("div");
    chips.className = "chips";
    for (const item of this.items) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `chip intent-${item.intent}`;
      chip.textContent = `${INTENT_LABEL[item.intent]} · ${item.ref}`;
      chip.title = "Tap to drop this mark";
      chip.addEventListener("click", () => this.remove(item.id));
      chips.appendChild(chip);
    }
    if (this.items.length > 0) this.panel.appendChild(chips);

    if (this.image !== undefined) {
      const image = document.createElement("img");
      image.className = "draft-image";
      image.src = this.image;
      image.alt = "Marked-up capture";
      this.panel.appendChild(image);
    }

    const pre = document.createElement("pre");
    pre.className = "draft-prompt";
    pre.textContent = prompt;
    this.panel.appendChild(pre);

    const row = document.createElement("div");
    row.className = "draft-actions";

    const field = document.createElement("input");
    field.type = "text";
    field.className = "note-field";
    field.placeholder = "Write here with the pen — Samsung converts it to text";
    field.value = this.note;
    field.addEventListener("input", () => this.setNoteQuietly(field.value));
    row.appendChild(field);

    const send = document.createElement("button");
    send.type = "button";
    send.className = "primary";
    send.textContent = "Send";
    send.addEventListener("click", () => this.options.onSend?.(this.promptText()));
    row.appendChild(send);

    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear";
    clear.addEventListener("click", () => this.options.onClear?.());
    row.appendChild(clear);

    this.panel.appendChild(row);
  }

  /** Keeps the caret alive while typing or handwriting into the note field. */
  setNoteQuietly(value) {
    this.note = value;
    const pre = this.panel.querySelector(".draft-prompt");
    if (pre !== null) pre.textContent = this.promptText();
  }
}
