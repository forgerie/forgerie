/**
 * PROTOTYPE — variant B: margin review.
 *
 * The diff keeps a wide gutter. Any pen mark in the gutter attaches to the
 * nearest diff line and opens a small field, so review reads like paper: mark
 * the line, write the remark beside it. Each remark becomes one agent task.
 */

import { InkLayer } from "../ink.js";
import { diff } from "../fixtures.js";

export const id = "margin";
export const title = "Margin review";
export const hint = "Write in the left margin next to a diff line. Each note becomes a task for the agent.";

export function mount(root, shared) {
  root.innerHTML = `
    <div class="split">
      <section class="scroller">
        <div class="content diff-content" id="content">
          <p class="file-head" id="file-head"></p>
          <div class="diff" id="diff"></div>
        </div>
      </section>
      <aside class="panel" id="panel"></aside>
    </div>`;

  root.querySelector("#file-head").textContent = diff.file;
  const diffRoot = root.querySelector("#diff");
  renderDiff(diffRoot);

  const content = root.querySelector("#content");
  const panel = root.querySelector("#panel");
  const notes = [];

  const ink = new InkLayer(content, {
    onStroke: (stroke) => handleStroke(stroke),
    onArmChange: (armed) => shared.setArmed(armed),
  });
  shared.registerInk(ink);
  renderPanel();

  function handleStroke(stroke) {
    if (stroke.kind === "tap") return;
    const midY = stroke.points.reduce((sum, point) => sum + point.y, 0) / stroke.points.length;
    const rows = [...diffRoot.querySelectorAll(".row")];
    let nearest = rows[0];
    let best = Infinity;
    for (const row of rows) {
      const rect = ink.rectFor(row);
      const gap = Math.abs((rect.top + rect.bottom) / 2 - midY);
      if (gap < best) {
        best = gap;
        nearest = row;
      }
    }
    const line = nearest.dataset["line"] ?? "?";
    const verdict = stroke.barrel === true ? "reject" : "note";
    notes.push({ id: stroke.id, line, verdict, text: "" });
    nearest.classList.add(`row-${verdict}`);
    renderPanel();
    window.setTimeout(() => panel.querySelector(`[data-note="${stroke.id}"]`)?.focus(), 0);
  }

  function renderPanel() {
    panel.innerHTML = "<h2>Review notes</h2>";
    if (notes.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Mark a line in the margin with the pen.";
      panel.appendChild(empty);
      return;
    }
    for (const note of notes) {
      const row = document.createElement("div");
      row.className = `note note-${note.verdict}`;

      const label = document.createElement("span");
      label.className = "note-line";
      label.textContent = `${diff.file}:${note.line}`;
      row.appendChild(label);

      const field = document.createElement("input");
      field.type = "text";
      field.dataset["note"] = note.id;
      field.placeholder = note.verdict === "reject" ? "Why is this wrong?" : "What should change?";
      field.value = note.text;
      field.addEventListener("input", () => {
        note.text = field.value;
        renderPrompt();
      });
      row.appendChild(field);

      const drop = document.createElement("button");
      drop.type = "button";
      drop.textContent = "×";
      drop.title = "Drop this note";
      drop.addEventListener("click", () => {
        notes.splice(notes.indexOf(note), 1);
        ink.removeStroke(note.id);
        renderPanel();
      });
      row.appendChild(drop);

      panel.appendChild(row);
    }

    const pre = document.createElement("pre");
    pre.className = "draft-prompt";
    pre.id = "margin-prompt";
    panel.appendChild(pre);

    const send = document.createElement("button");
    send.type = "button";
    send.className = "primary";
    send.textContent = "Send review";
    send.addEventListener("click", () => shared.toast(`Would send ${String(notes.length)} review notes`));
    panel.appendChild(send);

    renderPrompt();
  }

  function renderPrompt() {
    const pre = panel.querySelector("#margin-prompt");
    if (pre === null) return;
    pre.textContent = notes
      .map((note) => `- ${note.verdict === "reject" ? "reject" : "change"} ${diff.file}:${note.line}${note.text === "" ? "" : ` — ${note.text}`}`)
      .join("\n");
  }

  return () => ink.observer.disconnect();
}

function renderDiff(target) {
  for (const hunk of diff.hunks) {
    const header = document.createElement("p");
    header.className = "hunk";
    header.textContent = hunk.header;
    target.appendChild(header);
    for (const line of hunk.lines) {
      const row = document.createElement("div");
      row.className = `row row-${line.kind}`;
      row.dataset["line"] = String(line.n);

      const gutter = document.createElement("span");
      gutter.className = "gutter";
      row.appendChild(gutter);

      const number = document.createElement("span");
      number.className = "num";
      number.textContent = String(line.n);
      row.appendChild(number);

      const code = document.createElement("span");
      code.className = "code-cell";
      code.textContent = `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "} ${line.text}`;
      row.appendChild(code);

      target.appendChild(row);
    }
  }
}
