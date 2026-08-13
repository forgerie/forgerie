/**
 * PROTOTYPE — variant D: capability probe.
 *
 * Before designing anything for the pen, find out what this browser on this
 * tablet actually reports. Draw, hover, press the barrel button, flip to the
 * eraser, and rest your palm on the pad. The observed column fills in.
 */

export const id = "probe";
export const title = "Pen probe";
export const hint = "Draw, hover, press the side button, flip the pen over, rest your palm. Watch what the browser reports.";

const CAPABILITIES = [
  ["hover", "Hover without contact (pressure 0)"],
  ["pressure", "Pressure varies between strokes"],
  ["tilt", "Tilt reported (tiltX / tiltY)"],
  ["twist", "Barrel rotation reported (twist)"],
  ["barrel", "Side button reported (buttons & 2)"],
  ["eraser", "Eraser tip reported (buttons & 32)"],
  ["coalesced", "Coalesced events (more than one per frame)"],
  ["palm", "Touch arrives while the pen is down"],
  ["predicted", "Predicted events available"],
];

export function mount(root, shared) {
  root.innerHTML = `
    <div class="split">
      <section class="scroller">
        <div class="content probe-content">
          <div class="probe-pad" id="pad"><span>draw here</span></div>
          <table class="probe-table">
            <thead><tr><th>Signal</th><th>Now</th></tr></thead>
            <tbody id="live"></tbody>
          </table>
        </div>
      </section>
      <aside class="panel">
        <h2>Observed on this device</h2>
        <ul class="caps" id="caps"></ul>
        <h2>Event log</h2>
        <pre class="log" id="log"></pre>
      </aside>
    </div>`;

  const pad = root.querySelector("#pad");
  const live = root.querySelector("#live");
  const capsList = root.querySelector("#caps");
  const log = root.querySelector("#log");

  const observed = new Set();
  const lines = [];
  let penDown = false;
  let rate = 0;
  let lastMoveAt = 0;

  const canvas = document.createElement("canvas");
  canvas.className = "probe-canvas";
  pad.appendChild(canvas);
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;

  function sizeCanvas() {
    canvas.width = Math.round(pad.clientWidth * ratio);
    canvas.height = Math.round(pad.clientHeight * ratio);
    canvas.style.width = `${String(pad.clientWidth)}px`;
    canvas.style.height = `${String(pad.clientHeight)}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  sizeCanvas();
  const observer = new ResizeObserver(() => sizeCanvas());
  observer.observe(pad);

  renderCaps();
  renderLive({});

  let previous;
  pad.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "pen") penDown = true;
    if (event.pointerType === "touch" && penDown) note("palm");
    previous = point(event);
    pad.classList.add("used");
    pad.setPointerCapture(event.pointerId);
    record(event, "down");
    event.preventDefault();
  });

  pad.addEventListener("pointermove", (event) => {
    const now = performance.now();
    if (lastMoveAt !== 0) rate = Math.round(1000 / Math.max(now - lastMoveAt, 1));
    lastMoveAt = now;

    if (typeof event.getCoalescedEvents === "function" && event.getCoalescedEvents().length > 1) note("coalesced");
    if (typeof event.getPredictedEvents === "function" && event.getPredictedEvents().length > 0) note("predicted");
    if (event.pointerType === "pen" && event.pressure === 0 && event.buttons === 0) note("hover");
    if (event.pointerType === "touch" && penDown) note("palm");
    inspect(event);

    if (event.buttons !== 0 && previous !== undefined) {
      const current = point(event);
      context.strokeStyle = (event.buttons & 32) !== 0 ? "#ff4f7b" : (event.buttons & 2) !== 0 ? "#ffcc66" : "#b7a2ff";
      context.lineCap = "round";
      context.lineWidth = 1 + (event.pressure || 0.4) * 6;
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(current.x, current.y);
      context.stroke();
      previous = current;
    } else {
      previous = point(event);
    }
    renderLive(event);
    event.preventDefault();
  });

  pad.addEventListener("pointerup", (event) => {
    if (event.pointerType === "pen") penDown = false;
    record(event, "up");
  });
  pad.addEventListener("pointerleave", (event) => record(event, "leave"));

  let seenPressures = new Set();
  function inspect(event) {
    if (event.pointerType !== "pen") return;
    if (event.pressure > 0) seenPressures.add(Math.round(event.pressure * 20));
    if (seenPressures.size > 3) note("pressure");
    if (event.tiltX !== 0 || event.tiltY !== 0) note("tilt");
    if ((event.twist ?? 0) !== 0) note("twist");
    if ((event.buttons & 2) !== 0) note("barrel");
    if ((event.buttons & 32) !== 0) note("eraser");
  }

  function point(event) {
    const rect = pad.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function note(key) {
    if (observed.has(key)) return;
    observed.add(key);
    renderCaps();
    append(`first ${key}`);
  }

  function record(event, phase) {
    append(`${phase} ${event.pointerType} buttons=${String(event.buttons)} pressure=${event.pressure.toFixed(2)}`);
  }

  function append(text) {
    lines.unshift(text);
    if (lines.length > 40) lines.pop();
    log.textContent = lines.join("\n");
  }

  function renderCaps() {
    capsList.innerHTML = "";
    for (const [key, label] of CAPABILITIES) {
      const item = document.createElement("li");
      item.className = observed.has(key) ? "cap yes" : "cap no";
      item.textContent = `${observed.has(key) ? "✓" : "·"} ${label}`;
      capsList.appendChild(item);
    }
  }

  function renderLive(event) {
    const rows = [
      ["pointerType", event.pointerType ?? "—"],
      ["pressure", event.pressure === undefined ? "—" : event.pressure.toFixed(3)],
      ["tangentialPressure", event.tangentialPressure === undefined ? "—" : event.tangentialPressure.toFixed(3)],
      ["tiltX / tiltY", event.tiltX === undefined ? "—" : `${String(event.tiltX)} / ${String(event.tiltY)}`],
      ["twist", event.twist === undefined ? "—" : String(event.twist)],
      ["buttons", event.buttons === undefined ? "—" : String(event.buttons)],
      ["contact width × height", event.width === undefined ? "—" : `${event.width.toFixed(1)} × ${event.height.toFixed(1)}`],
      ["move rate", `${String(rate)} Hz`],
      ["devicePixelRatio", String(window.devicePixelRatio)],
      ["viewport (CSS px)", `${String(window.innerWidth)} × ${String(window.innerHeight)}`],
      ["any-pointer: fine", String(window.matchMedia("(any-pointer: fine)").matches)],
      ["any-hover: hover", String(window.matchMedia("(any-hover: hover)").matches)],
    ];
    live.innerHTML = "";
    for (const [label, value] of rows) {
      const row = document.createElement("tr");
      const key = document.createElement("th");
      key.textContent = label;
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(key, cell);
      live.appendChild(row);
    }
  }

  shared.setArmed(true);
  return () => observer.disconnect();
}
