// Variant A — Follow. The whole transcript stays on screen; the voice points at it.
// Question it answers: is a guide over the same content enough?

import { blockBody, blockLabel } from "../blocks.js";
import { el, setFlag, syncList } from "../dom.js";

export const follow = {
  id: "follow",
  name: "Follow",
  hint: "Full transcript. The voice marks what it is talking about.",

  mount(root, { engine }) {
    const feed = el("div", { class: "follow-feed" });
    const activity = el("div", { class: "follow-activity" });
    const caption = el("div", { class: "follow-caption" });
    root.append(
      el(
        "section",
        { class: "follow" },
        el("header", { class: "follow-head" }, el("h1", { class: "follow-title" }), activity),
        feed,
        caption,
      ),
    );
    this.nodes = { root, feed, activity, caption, engine, lastAttention: undefined };
  },

  update(view) {
    const { feed, activity, caption, engine, root } = this.nodes;
    root.querySelector(".follow-title").textContent = view.title || "Session";
    activity.textContent = activityLine(view);
    setFlag(activity, "is-live", view.running && !view.paused);

    syncList(
      feed,
      view.blocks,
      (block) => block.id,
      (block) =>
        el(
          "article",
          { class: `row row-${block.kind}` },
          el("div", { class: "row-rail" }, el("span", { class: "row-label", text: blockLabel(block) })),
          el("div", { class: "row-body" }, blockBody(block, { onAnswer: (option) => engine.answer(option) })),
        ),
      (node, block) => setFlag(node, "attended", view.attention === block.id),
    );

    // Follow the voice, but never yank the view away from someone reading back.
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
    if (view.attention !== this.nodes.lastAttention) {
      this.nodes.lastAttention = view.attention;
      const node = feed.querySelector(`[data-key="${view.attention}"]`);
      if (atBottom || view.pending !== undefined) node?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (view.running && atBottom) {
      feed.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
    }

    caption.textContent = view.captions && view.speaking ? view.speaking.text : "";
    setFlag(caption, "is-shown", Boolean(view.captions && view.speaking));
  },
};

function activityLine(view) {
  if (view.paused) return "stopped";
  if (view.pending !== undefined) return "waiting on you";
  if (view.activity !== undefined) return view.activity;
  if (view.finished) return "done";
  if (view.running) return "working";
  return "idle";
}
