// PROTOTYPE instrument. Not part of the design under test.
// Shows what the narrator dropped, merged, and how close each spoken line came
// to dictating the screen.

import { el } from "./dom.js";
import { overlap } from "./narrator.js";
import { screenTextOf } from "./engine.js";

export function createProbe(root, { narrator }) {
  const panel = el("aside", { class: "probe" });
  root.append(panel);
  let open = false;

  function render(view) {
    if (!open) {
      panel.replaceChildren();
      return;
    }
    const stats = view.stats ?? {};
    const recent = narrator.log.slice(-14).reverse();
    panel.replaceChildren(
      el("h2", { text: "probe" }),
      el(
        "dl",
        { class: "probe-stats" },
        stat("workers", `${view.status?.stt ?? "?"} / ${view.status?.tts ?? "?"} / ${view.status?.turn ?? "?"}`),
        stat("offered", stats.offered ?? 0),
        stat("spoken", stats.spoken ?? 0),
        stat("merged", stats.merged ?? 0),
        stat("dropped", stats.dropped ?? 0),
        stat("queued", view.queued ?? 0),
        stat("barge-ins", view.bargeIns ?? 0),
        stat("rule breaks", stats.violations ?? 0),
      ),
      el("h3", { text: "voice against screen" }),
      el(
        "ul",
        { class: "probe-acts" },
        ...recent.map((entry) =>
          el(
            "li",
            { class: `probe-act is-${entry.status}` },
            el("span", { class: "probe-type", text: entry.act.type }),
            el("span", { class: "probe-status", text: entry.status }),
            el("span", { class: "probe-text", text: entry.act.text }),
            issueLine(entry.act),
          ),
        ),
      ),
      el("h3", { text: "heard from you" }),
      el(
        "ul",
        { class: "probe-heard" },
        ...[...(view.userTurns ?? [])].reverse().slice(0, 8).map((turn) =>
          el("li", {}, el("span", { class: "probe-intent", text: turn.intent }), el("span", { text: turn.text })),
        ),
      ),
      el("h3", { text: "dictation check" }),
      el("p", { class: "probe-note", text: dictationNote(view) }),
    );
  }

  return {
    get open() {
      return open;
    },
    toggle(view) {
      open = !open;
      document.body.classList.toggle("probe-open", open);
      render(view);
    },
    update(view) {
      render(view);
    },
  };
}

function stat(name, value) {
  return el("div", { class: "probe-stat" }, el("dt", { text: name }), el("dd", { text: String(value) }));
}

function issueLine(act) {
  const issues = act.review?.issues ?? [];
  const ratio = act.review?.ratio ?? 0;
  return el(
    "span",
    { class: `probe-issues ${issues.length > 0 ? "is-bad" : ""}` },
    issues.length > 0 ? issues.join(" · ") : `${Math.round(ratio * 100)}% overlap`,
  );
}

function dictationNote(view) {
  const spoken = view.spokenLog ?? [];
  if (spoken.length === 0) return "Nothing spoken yet.";
  const screen = view.blocks.map(screenTextOf).join(" ");
  const worst = spoken.reduce(
    (highest, act) => Math.max(highest, overlap(act.text, screen)),
    0,
  );
  return `Worst line overlap against everything on screen: ${Math.round(worst * 100)}%. Anything near 100% means the voice is reading the screen.`;
}
