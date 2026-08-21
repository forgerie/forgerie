// Variant B — Deck. No transcript. One card at a time, carrying only what the
// voice cannot say. Question it answers: is the screen better as evidence than
// as a log?

import { blockBody, blockLabel, isContent } from "../blocks.js";
import { el, setFlag } from "../dom.js";

export const deck = {
  id: "deck",
  name: "Deck",
  hint: "One card at a time. Only what speech cannot carry.",

  mount(root, { engine }) {
    const ribbon = el("div", { class: "deck-ribbon" });
    const stage = el("div", { class: "deck-stage" });
    const back = el("button", { class: "deck-step", type: "button", text: "‹", onclick: () => this.move(-1) });
    const forward = el("button", { class: "deck-step", type: "button", text: "›", onclick: () => this.move(1) });
    const counter = el("div", { class: "deck-counter" });
    root.append(
      el(
        "section",
        { class: "deck" },
        ribbon,
        el("div", { class: "deck-frame" }, back, stage, forward),
        el("footer", { class: "deck-foot" }, counter, el("div", { class: "deck-hint", text: "cards hold the evidence; the voice holds the thread" })),
      ),
    );
    this.nodes = { root, ribbon, stage, counter, engine };
    this.index = 0;
    this.pinned = false;
    this.renderedId = undefined;
  },

  move(direction) {
    const cards = this.cards ?? [];
    const next = Math.min(cards.length - 1, Math.max(0, this.index + direction));
    this.pinned = next !== cards.length - 1;
    this.index = next;
    if (this.view !== undefined) this.update(this.view);
  },

  update(view) {
    this.view = view;
    const { ribbon, stage, counter, engine } = this.nodes;
    const cards = view.blocks.filter((block) => isContent(block) && block.kind !== "prompt");
    this.cards = cards;
    if (!this.pinned) this.index = Math.max(0, cards.length - 1);
    if (view.pending !== undefined) {
      const questionIndex = cards.findIndex((card) => card.id === view.pending.blockId);
      if (questionIndex >= 0) {
        this.index = questionIndex;
        this.pinned = false;
      }
    }

    ribbon.replaceChildren(
      ...view.blocks.map((block) =>
        el("span", {
          class: `tick tick-${isContent(block) ? "card" : "quiet"}`,
          dataset: { key: block.id },
          title: blockLabel(block),
        }),
      ),
    );
    for (const [position, node] of [...ribbon.children].entries()) {
      const block = view.blocks[position];
      setFlag(node, "is-current", block !== undefined && block.id === cards[this.index]?.id);
    }

    const card = cards[this.index];
    if (card === undefined) {
      stage.replaceChildren(el("div", { class: "deck-empty", text: "nothing on the table yet" }));
      counter.textContent = "";
      this.renderedId = undefined;
      return;
    }
    if (this.renderedId !== card.id) {
      this.renderedId = card.id;
      stage.replaceChildren(
        el(
          "article",
          { class: `card card-${card.kind}` },
          el("div", { class: "card-kind", text: blockLabel(card) }),
          blockBody(card, { onAnswer: (option) => engine.answer(option) }),
        ),
      );
    }
    setFlag(stage, "attended", view.attention === card.id);
    counter.textContent = `${this.index + 1} of ${cards.length}${this.pinned ? " · held" : ""}`;
  },
};
