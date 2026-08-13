/**
 * PROTOTYPE — variant A: mark the transcript, build the prompt.
 *
 * Gesture vocabulary under test:
 *   circle / lasso   → include the enclosed lines as context
 *   line through text → ignore it (strike) or look at it (underline)
 *   arrow            → relate the two things it connects
 *   scribble         → open a note field for handwriting
 *   barrel button    → force "ignore" for whatever the stroke covers
 *   eraser tip       → remove ink, which removes the context item
 */

import { InkLayer } from "../ink.js";
import { Draft } from "../draft.js";
import { transcript } from "../fixtures.js";
import { lineCrossesRect, polygonCoverage } from "../geometry.js";
import { Dictation, speechSupport } from "../voice.js";

export const id = "context";
export const title = "Circle to context";
export const hint = "Circle code, strike out noise, draw an arrow between two marks. Turn on voice and talk while you mark.";

export function mount(root, shared) {
  root.innerHTML = `
    <div class="split">
      <section class="scroller" id="scroller">
        <div class="content" id="content"></div>
      </section>
      <aside class="panel" id="panel"></aside>
    </div>`;

  const content = root.querySelector("#content");
  renderTranscript(content);

  const panel = root.querySelector("#panel");
  const draft = new Draft(panel, {
    emptyHint: "Hover the pen over the transcript, then circle something.",
    onSend: (text) => shared.toast(`Would send ${String(text.split("\n").length)} lines of prompt`),
    onClear: () => {
      draft.clear();
      ink.clear();
      clearMarks();
    },
    onRemove: (item) => {
      if (item.strokeId !== undefined) ink.removeStroke(item.strokeId);
      unmark(item.ref);
    },
  });

  const ink = new InkLayer(content, {
    scroller: root.querySelector("#scroller"),
    onStroke: (stroke) => {
      handleStroke(stroke);
      dictation.release();
    },
    onStrokeStart: () => {
      if (voiceOn) dictation.hold();
    },
    onArmChange: (armed) => shared.setArmed(armed),
    onHoverMove: (event) => hoverPreview(event),
  });
  shared.registerInk(ink);

  // --- pen plus voice -------------------------------------------------------
  let voiceOn = false;
  const dictation = new Dictation({
    onPartial: (text) => showVoice(text, true),
    onFinal: (text) => {
      showVoice("", false);
      draft.setNote(draft.note === "" ? text : `${draft.note} ${text}`);
    },
    onState: (state) => shared.setListening(state === "listening"),
  });

  const voiceButton = document.createElement("button");
  voiceButton.type = "button";
  voiceButton.className = "voice-toggle";
  voiceButton.textContent = "voice while marking: off";
  voiceButton.addEventListener("click", () => {
    const support = speechSupport();
    if (!support.ok) {
      shared.toast(support.reason);
      return;
    }
    voiceOn = !voiceOn;
    voiceButton.textContent = `voice while marking: ${voiceOn ? "on" : "off"}`;
    voiceButton.setAttribute("aria-pressed", String(voiceOn));
    if (!voiceOn) dictation.stop();
  });

  function showVoice(text, partial) {
    let line = panel.querySelector(".voice-line");
    if (line === null) return;
    line.textContent = text;
    line.classList.toggle("partial", partial);
  }

  const originalRender = draft.render.bind(draft);
  draft.render = () => {
    originalRender();
    const line = document.createElement("p");
    line.className = "voice-line";
    panel.insertBefore(line, panel.children[1] ?? null);
    const support = speechSupport();
    if (!support.ok) {
      const warn = document.createElement("p");
      warn.className = "warn";
      warn.textContent = support.reason;
      panel.appendChild(warn);
    }
    panel.appendChild(voiceButton);
  };
  draft.render();

  function targets() {
    return [...content.querySelectorAll("[data-ref]")];
  }

  function handleStroke(stroke) {
    if (stroke.kind === "tap") return;

    if (stroke.kind === "lasso") {
      const hits = targets().filter((element) => polygonCoverage(ink.rectFor(element), stroke.points) >= 0.45);
      if (hits.length === 0) {
        shared.toast("Nothing inside that circle");
        ink.removeStroke(stroke.id);
        return;
      }
      addRange(hits, stroke.barrel === true ? "exclude" : "include", stroke.id);
      return;
    }

    if (stroke.kind === "line") {
      const hits = targets().filter((element) => lineCrossesRect(stroke.points, ink.rectFor(element)));
      if (hits.length === 0) {
        ink.removeStroke(stroke.id);
        return;
      }
      const first = ink.rectFor(hits[0]);
      const middle = stroke.points.reduce((sum, point) => sum + point.y, 0) / stroke.points.length;
      const throughMiddle = middle > first.top + first.height * 0.3 && middle < first.bottom - first.height * 0.25;
      const intent = stroke.barrel === true || throughMiddle ? "exclude" : "investigate";
      addRange(hits, intent, stroke.id);
      return;
    }

    if (stroke.kind === "arrow") {
      const last = draft.items.slice(-2);
      if (last.length < 2) {
        shared.toast("Mark two things first, then draw the arrow");
        ink.removeStroke(stroke.id);
        return;
      }
      draft.add({ intent: "relate", ref: `${last[0].ref} → ${last[1].ref}`, strokeId: stroke.id });
      return;
    }

    // A scribble is treated as handwriting: focus the note field so the pen can
    // write straight into it and the platform can convert the ink to text.
    ink.removeStroke(stroke.id);
    const field = panel.querySelector(".note-field");
    if (field === null) {
      draft.setNote(" ");
      panel.querySelector(".note-field")?.focus();
      return;
    }
    field.focus();
  }

  function addRange(elements, intent, strokeId) {
    const ref = describe(elements);
    for (const element of elements) element.classList.add(`marked-${intent}`);
    draft.add({ intent, ref, text: shortText(elements), strokeId });
  }

  function describe(elements) {
    const first = elements[0];
    const source = first.dataset["ref"];
    const lines = elements.map((element) => Number(element.dataset["line"])).filter((value) => Number.isFinite(value));
    if (lines.length === 0) return source;
    const min = Math.min(...lines);
    const max = Math.max(...lines);
    return min === max ? `${source}:${String(min)}` : `${source}:${String(min)}-${String(max)}`;
  }

  function shortText(elements) {
    const text = elements.map((element) => element.textContent?.trim() ?? "").join(" ").replace(/\s+/g, " ");
    return text.length > 64 ? `${text.slice(0, 61)}…` : text;
  }

  function unmark(ref) {
    for (const element of targets()) {
      if (ref.startsWith(element.dataset["ref"] ?? "\u0000")) element.classList.remove("marked-include", "marked-investigate", "marked-exclude");
    }
  }

  function clearMarks() {
    for (const element of targets()) element.classList.remove("marked-include", "marked-investigate", "marked-exclude", "hovered");
  }

  let hovered;
  function hoverPreview(event) {
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-ref]");
    if (element === hovered) return;
    hovered?.classList.remove("hovered");
    hovered = element ?? undefined;
    hovered?.classList.add("hovered");
  }

  return () => {
    dictation.stop();
    ink.observer.disconnect();
  };
}

function renderTranscript(content) {
  for (const message of transcript) {
    const article = document.createElement("article");
    article.className = `msg role-${message.role}`;

    const role = document.createElement("p");
    role.className = "role";
    role.textContent = message.title ?? (message.role === "human" ? "you" : message.role);
    article.appendChild(role);

    for (const block of message.blocks) {
      if (block.kind === "prose") {
        const paragraph = document.createElement("p");
        paragraph.className = "prose";
        paragraph.dataset["ref"] = block.ref;
        paragraph.textContent = block.text;
        article.appendChild(paragraph);
        continue;
      }
      const pre = document.createElement("pre");
      pre.className = block.kind === "code" ? "code" : "output";
      block.lines.forEach((text, index) => {
        const line = document.createElement("span");
        line.className = "line";
        line.dataset["ref"] = block.ref;
        if (block.startLine !== undefined) line.dataset["line"] = String(block.startLine + index);
        line.textContent = text === "" ? " " : text;
        pre.appendChild(line);
      });
      article.appendChild(pre);
    }
    content.appendChild(article);
  }
}
