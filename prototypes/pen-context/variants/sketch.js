/**
 * PROTOTYPE — variant C: send the drawing to the agent.
 *
 * The thing a keyboard is bad at: a box-and-arrow diagram, a circle round the
 * broken part of a screenshot, an arrow saying "this goes there". Load a real
 * screenshot from the tablet, draw on it, and send the flattened image with a
 * short spoken or written instruction.
 */

import { InkLayer } from "../ink.js";
import { Draft } from "../draft.js";
import { Dictation, speechSupport } from "../voice.js";

export const id = "sketch";
export const title = "Send a drawing";
export const hint = "Load a screenshot or draw on the blank sheet, then send the picture to the agent.";

export function mount(root, shared) {
  root.innerHTML = `
    <div class="split">
      <section class="scroller" id="scroller">
        <div class="content sketch-content" id="content">
          <div class="sheet" id="sheet">
            <img id="backdrop" alt="" hidden />
            <div class="sheet-empty" id="sheet-empty">
              <p>Blank sheet — draw a diagram,</p>
              <p>or load a screenshot to mark up.</p>
            </div>
          </div>
        </div>
      </section>
      <aside class="panel" id="panel"></aside>
    </div>`;

  const content = root.querySelector("#content");
  const panel = root.querySelector("#panel");
  const backdrop = root.querySelector("#backdrop");
  const sheetEmpty = root.querySelector("#sheet-empty");

  const draft = new Draft(panel, {
    emptyHint: "Draw something, then press Send drawing.",
    onSend: () => sendDrawing(),
    onClear: () => {
      draft.clear();
      ink.clear();
      renderTools();
    },
  });

  const ink = new InkLayer(content, {
    scroller: root.querySelector("#scroller"),
    onStroke: () => renderTools(),
    onStrokeStart: () => {
      if (voiceOn) dictation.hold();
    },
    onArmChange: (armed) => shared.setArmed(armed),
  });
  shared.registerInk(ink);

  let voiceOn = false;
  const dictation = new Dictation({
    onFinal: (text) => draft.setNote(draft.note === "" ? text : `${draft.note} ${text}`),
    onState: (state) => shared.setListening(state === "listening"),
  });

  renderTools();

  /** Flattens the backdrop and the ink into one image, the way a real send would. */
  function flatten() {
    const canvas = document.createElement("canvas");
    const source = ink.canvas;
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#0b0e1a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!backdrop.hidden) {
      const rect = backdrop.getBoundingClientRect();
      const canvasRect = source.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      context.drawImage(backdrop, (rect.left - canvasRect.left) * ratio, (rect.top - canvasRect.top) * ratio, rect.width * ratio, rect.height * ratio);
    }
    context.drawImage(source, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function sendDrawing() {
    const image = flatten();
    const kilobytes = Math.round((image.length * 0.75) / 1024);
    shared.toast(`Would send drawing.png (${String(kilobytes)} kB) plus ${String(draft.note.length)} characters`);
  }

  function loadImage(file) {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      backdrop.src = String(reader.result);
      backdrop.hidden = false;
      sheetEmpty.hidden = true;
      backdrop.addEventListener("load", () => ink.resize(), { once: true });
    });
    reader.readAsDataURL(file);
  }

  window.addEventListener("paste", onPaste);
  function onPaste(event) {
    const item = [...(event.clipboardData?.items ?? [])].find((candidate) => candidate.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (file != null) loadImage(file);
  }

  function renderTools() {
    for (const node of panel.querySelectorAll(".sketch-tools")) node.remove();
    const tools = document.createElement("div");
    tools.className = "sketch-tools";

    const label = document.createElement("label");
    label.className = "file-button";
    label.textContent = "Load screenshot";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file != null) loadImage(file);
    });
    label.appendChild(input);
    tools.appendChild(label);

    const voice = document.createElement("button");
    voice.type = "button";
    voice.textContent = `voice: ${voiceOn ? "on" : "off"}`;
    voice.addEventListener("click", () => {
      const support = speechSupport();
      if (!support.ok) {
        shared.toast(support.reason);
        return;
      }
      voiceOn = !voiceOn;
      voice.textContent = `voice: ${voiceOn ? "on" : "off"}`;
      if (!voiceOn) dictation.stop();
      else dictation.hold();
    });
    tools.appendChild(voice);

    const send = document.createElement("button");
    send.type = "button";
    send.className = "primary";
    send.textContent = "Send drawing";
    send.addEventListener("click", () => {
      draft.setImage(flatten());
      sendDrawing();
    });
    tools.appendChild(send);

    panel.appendChild(tools);
  }

  return () => {
    window.removeEventListener("paste", onPaste);
    dictation.stop();
    ink.observer.disconnect();
  };
}
