// Variant C — Ambient. Headless first. The screen stays dark and only wakes when
// the voice hands something over or you ask. Question it answers: how little
// screen can carry a long task?

import { blockBody, blockLabel, isContent } from "../blocks.js";
import { el, setFlag } from "../dom.js";

export const ambient = {
  id: "ambient",
  name: "Ambient",
  hint: "Dark by default. Content appears only on handoff or request.",

  mount(root, { engine }) {
    const orb = el("div", { class: "orb" }, el("span", { class: "orb-core" }));
    const line = el("div", { class: "ambient-line" });
    const count = el("div", { class: "ambient-count" });
    const sheet = el("div", { class: "ambient-sheet" });
    const peek = el("button", {
      class: "ambient-peek",
      type: "button",
      text: "hold to look",
      onpointerdown: () => this.setPeek(true),
      onpointerup: () => this.setPeek(false),
      onpointerleave: () => this.setPeek(false),
    });
    root.append(el("section", { class: "ambient" }, orb, line, count, sheet, peek));
    this.nodes = { root, orb, line, count, sheet, peek, engine };
    this.peeking = false;
    this.renderedId = undefined;
  },

  setPeek(value) {
    this.peeking = value;
    if (this.view !== undefined) this.update(this.view);
  },

  update(view) {
    this.view = view;
    const { orb, line, count, sheet, peek } = this.nodes;
    setFlag(orb, "is-speaking", Boolean(view.speaking));
    setFlag(orb, "is-hearing", view.listening === "hearing");
    orb.style.setProperty("--level", String(Math.min(1, (view.level ?? 0) * 12)));

    line.textContent = ambientLine(view);
    const quiet = view.blocks.filter((block) => !isContent(block)).length;
    count.textContent = quiet > 0 ? `${quiet} steps you did not need to see` : "";

    const shown = surfaced(view, this.peeking);
    setFlag(peek, "is-hidden", shown !== undefined);
    if (shown === undefined) {
      sheet.replaceChildren();
      setFlag(sheet, "is-open", false);
      this.renderedId = undefined;
      return;
    }
    if (this.renderedId !== shown.id || view.pending !== undefined) {
      this.renderedId = shown.id;
      sheet.replaceChildren(
        el("div", { class: "sheet-kind", text: blockLabel(shown) }),
        blockBody(shown, { onAnswer: (option) => this.nodes.engine.answer(option) }),
      );
    }
    setFlag(sheet, "is-open", true);
    setFlag(sheet, "is-peek", this.peeking && view.pending === undefined);
  },
};

function surfaced(view, peeking) {
  if (view.pending !== undefined) {
    return view.blocks.find((block) => block.id === view.pending.blockId);
  }
  const candidates = view.blocks.filter((block) => isContent(block) && block.kind !== "prompt");
  if (peeking) return candidates[candidates.length - 1];
  const revealed = candidates.filter((block) => view.revealed.includes(block.id));
  const latest = revealed[revealed.length - 1];
  if (latest === undefined) return undefined;
  const isCurrent = view.speaking?.refers === latest.id || view.attention === latest.id;
  return isCurrent || latest.kind === "answer" ? latest : undefined;
}

function ambientLine(view) {
  if (view.paused) return "stopped";
  if (view.pending !== undefined) return "your call";
  if (view.speaking !== undefined) return "…";
  if (view.activity !== undefined) return view.activity;
  if (view.finished) return "done";
  if (view.running) return "working";
  return "ready";
}
