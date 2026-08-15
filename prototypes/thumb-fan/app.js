/**
 * Wiring only. Every decision worth arguing about lives in fan.js, press.js,
 * or a file under variants/.
 */

import { FAN_DEFAULTS } from "./fan.js";
import { createPressRecogniser } from "./press.js";
import { TARGETS, TURNS } from "./fixtures.js";
import { DEFAULT_VARIANT, VARIANTS, variantById } from "./variants/index.js";

const transcript = document.querySelector("#transcript");
const stage = document.querySelector("#stage");
const surface = document.querySelector("#surface");
const readout = document.querySelector("#readout");
const controls = document.querySelector("#controls");
const variantBar = document.querySelector("#variants");
const blurb = document.querySelector("#blurb");

const settings = {
  // Eight slots: seven panels and More. Radial fixes a direction per slot, so
  // this number is a commitment rather than a preference — see README.
  count: 8,
  radiusPx: FAN_DEFAULTS.radiusPx,
  originOffsetPx: FAN_DEFAULTS.originOffsetPx,
  spacingDeg: FAN_DEFAULTS.spacingDeg,
  deadzonePx: FAN_DEFAULTS.deadzonePx,
  holdMs: 500,
  order: "ordinal",
  side: 180,
  zone: "anywhere",
  // On by default, unlike the first draft.
  //
  // The transcript is selectable text, and on Android a long press on
  // selectable text raises the platform selection callout, which takes the
  // pointer stream and the gesture never arms. Headless Chromium does not
  // implement that behaviour, so no capture or check in this folder can catch
  // it — it only shows up in a hand, as "nothing happens anywhere".
  //
  // The cost is real and unchanged: copy-from-transcript is off while this is
  // on. The toggle is still there to feel the trade.
  suppressCallout: true,
  debug: false,
};

const query = new URLSearchParams(window.location.search);
let variant = variantById(query.get("v") ?? DEFAULT_VARIANT);
const requestedCount = Number(query.get("n"));
if (Number.isInteger(requestedCount) && requestedCount >= 3 && requestedCount <= 12) settings.count = requestedCount;
let session;
let hovered;
let armRing;
let armedAt = 0;
let maxTravel = 0;
let recogniser = createPressRecogniser({ holdMs: settings.holdMs });

// ---------------------------------------------------------------- transcript

function renderTranscript() {
  transcript.replaceChildren(...TURNS.map((turn) => {
    const row = document.createElement("article");
    row.className = `turn ${turn.role}`;

    const gutter = document.createElement("div");
    gutter.className = "gutter";
    gutter.dataset.press = "gutter";
    gutter.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "body";

    const text = document.createElement("p");
    text.textContent = turn.text;
    body.append(text);

    if (turn.code !== undefined) {
      const pre = document.createElement("pre");
      pre.textContent = turn.code;
      body.append(pre);
    }

    row.append(gutter, body);
    return row;
  }));
}

// ------------------------------------------------------------- the gesture

const pointOf = (event) => ({ x: event.clientX, y: event.clientY });
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

function fanOptions() {
  return {
    radiusPx: settings.radiusPx,
    spacingDeg: settings.spacingDeg,
    deadzonePx: settings.deadzonePx,
    order: settings.order,
    preferredBearingDeg: settings.side,
    originOffsetPx: settings.originOffsetPx,
  };
}

function insideZone(event) {
  if (settings.zone === "anywhere") return true;
  return event.target instanceof HTMLElement && event.target.dataset.press === "gutter";
}

/**
 * The hold has to look like it is happening.
 *
 * Before this, a press that was arming and a press that was being ignored were
 * pixel-identical for half a second, so anyone who let go early learned that
 * the gesture was unreliable. The ring closes in over exactly `holdMs`, which
 * also makes the gesture discoverable by accident.
 */
function showArmRing(press) {
  armRing = document.createElement("div");
  armRing.className = "arm-ring";
  armRing.style.left = `${press.x}px`;
  armRing.style.top = `${press.y}px`;
  armRing.style.animationDuration = `${settings.holdMs}ms`;
  surface.append(armRing);
}

function clearArmRing() {
  armRing?.remove();
  armRing = undefined;
}

/** Where the finger actually landed, for judging `shift` against the surface. */
function pressDot(press) {
  const dot = document.createElement("div");
  dot.className = "press-dot";
  dot.style.left = `${press.x}px`;
  dot.style.top = `${press.y}px`;
  return dot;
}

function openSurface(press) {
  clearArmRing();
  session = variant.open({ press: press.origin, viewport: viewport(), targets: TARGETS, settings: { ...settings, fanOptions: fanOptions() } });
  if (session === undefined) {
    log(`${variant.title}: no room at this press point`);
    return;
  }
  armedAt = Date.now();
  maxTravel = 0;
  hovered = undefined;
  document.body.classList.add("armed");
  surface.replaceChildren(...session.nodes);
  if (settings.debug) surface.append(pressDot(press.origin));
  session.paint(undefined);
  navigator.vibrate?.(12);
}

function closeSurface() {
  clearArmRing();
  session = undefined;
  hovered = undefined;
  document.body.classList.remove("armed");
  surface.replaceChildren();
}

function onPointerDown(event) {
  if (event.target.closest("#controls") !== null || event.target.closest("#variants") !== null) return;
  if (!insideZone(event)) return;
  clearArmRing();
  showArmRing(pointOf(event));
  recogniser.down(pointOf(event), event.pointerId, openSurface);
}

function onPointerMove(event) {
  const state = recogniser.move(pointOf(event), event.pointerId);
  if (state.kind === "abandoned") clearArmRing();
  if (state.kind !== "armed" || session === undefined) return;
  event.preventDefault();

  const point = pointOf(event);
  maxTravel = Math.max(maxTravel, Math.hypot(point.x - state.origin.x, point.y - state.origin.y));
  const next = session.select(point);
  if (next === hovered) return;
  hovered = next;
  if (next !== undefined) navigator.vibrate?.(6);
  session.paint(hovered);
}

function onPointerUp(event) {
  const finished = recogniser.up(event.pointerId);
  clearArmRing();
  if (finished.kind !== "armed" || session === undefined) {
    closeSurface();
    return;
  }
  const chosen = hovered === undefined ? undefined : TARGETS[hovered];
  const held = Date.now() - armedAt;
  // A reserved slot is a real direction with nothing behind it today. It
  // absorbs the release rather than opening anything, so the bearing stays
  // learnable without ever landing somewhere useless.
  const label = chosen === undefined
    ? `cancelled \u00b7 travel ${Math.round(maxTravel)}px \u00b7 ${held}ms open`
    : (chosen.available === false
      ? `${chosen.label} is empty \u2014 no-op (slot ${chosen.slot ?? "?"} stays reserved)`
      : `${chosen.label}${chosen.slot === undefined ? "" : ` \u00b7 ${chosen.slot}`} \u00b7 travel ${Math.round(maxTravel)}px \u00b7 ${held}ms`);
  log(`${variant.title}: ${label}`);
  closeSurface();
}

function onPointerCancel() {
  recogniser.cancel();
  closeSurface();
}

// Once armed the page must stop scrolling under the finger. Before armed it
// must not, or the transcript cannot be read.
function onTouchMove(event) {
  if (recogniser.state.kind === "armed" && event.cancelable) event.preventDefault();
}

function log(line) {
  const stamp = new Date().toLocaleTimeString([], { hour12: false });
  const entry = document.createElement("div");
  entry.textContent = `${stamp}  ${line}`;
  readout.prepend(entry);
  while (readout.childElementCount > 5) readout.lastElementChild.remove();
}

// -------------------------------------------------------------- the switcher

function renderVariantBar() {
  variantBar.replaceChildren(...VARIANTS.map((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = entry.title;
    button.setAttribute("aria-pressed", String(entry.id === variant.id));
    button.addEventListener("click", () => {
      variant = entry;
      closeSurface();
      const url = new URL(window.location.href);
      url.searchParams.set("v", entry.id);
      window.history.replaceState({}, "", url);
      renderVariantBar();
      renderControls();
      log(`variant: ${entry.title}`);
    });
    return button;
  }));
  blurb.textContent = variant.blurb;
}

// -------------------------------------------------------------- the controls

const CONTROL_SPEC = [
  { key: "count", kind: "range", label: "targets", min: 3, max: 12, step: 1 },
  { key: "radiusPx", kind: "range", label: "radius", min: 48, max: 160, step: 4, unit: "px" },
  { key: "originOffsetPx", kind: "range", label: "shift", min: 0, max: 120, step: 4, unit: "px" },
  { key: "spacingDeg", kind: "range", label: "spacing", min: 16, max: 55, step: 1, unit: "\u00b0" },
  { key: "deadzonePx", kind: "range", label: "dead zone", min: 8, max: 60, step: 2, unit: "px" },
  { key: "holdMs", kind: "range", label: "hold", min: 200, max: 900, step: 25, unit: "ms" },
  { key: "order", kind: "choice", label: "order", options: [["ordinal", "from bottom"], ["sweep", "along arc"]] },
  { key: "side", kind: "choice", label: "opens", options: [[180, "left"], [0, "right"], [null, "away from edge"]] },
  { key: "zone", kind: "choice", label: "press zone", options: [["anywhere", "anywhere"], ["gutter", "gutter only"]] },
  { key: "suppressCallout", kind: "toggle", label: "block text selection" },
  { key: "debug", kind: "toggle", label: "mark press point" },
];

/** Always-relevant controls; the rest are shown only if the variant reads them. */
const UNIVERSAL = new Set(["holdMs", "zone", "suppressCallout", "debug"]);

function renderControls() {
  const body = controls.querySelector(".controls-body");
  const visible = CONTROL_SPEC.filter((spec) => UNIVERSAL.has(spec.key) || variant.uses.includes(spec.key));

  body.replaceChildren(...visible.map((spec) => {
    const row = document.createElement("label");
    row.className = `control control-${spec.kind}`;

    const name = document.createElement("span");
    name.className = "control-name";
    name.textContent = spec.label;
    row.append(name);

    if (spec.kind === "range") {
      const value = document.createElement("span");
      value.className = "control-value";
      value.textContent = `${settings[spec.key]}${spec.unit ?? ""}`;

      const input = document.createElement("input");
      input.type = "range";
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      input.value = String(settings[spec.key]);
      input.addEventListener("input", () => {
        settings[spec.key] = Number(input.value);
        value.textContent = `${settings[spec.key]}${spec.unit ?? ""}`;
        if (spec.key === "holdMs") recogniser = createPressRecogniser({ holdMs: settings.holdMs });
      });
      row.append(input, value);
    }

    if (spec.kind === "choice") {
      const group = document.createElement("span");
      group.className = "control-choice";
      for (const [value, text] of spec.options) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.setAttribute("aria-pressed", String(settings[spec.key] === value));
        button.addEventListener("click", () => {
          settings[spec.key] = value;
          applySettings();
          renderControls();
        });
        group.append(button);
      }
      row.append(group);
    }

    if (spec.kind === "toggle") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = settings[spec.key];
      input.addEventListener("change", () => {
        settings[spec.key] = input.checked;
        applySettings();
      });
      row.append(input);
    }

    return row;
  }));
}

function applySettings() {
  document.body.classList.toggle("no-select", settings.suppressCallout);
  document.body.classList.toggle("zone-gutter", settings.zone === "gutter");
  document.body.classList.toggle("debug", settings.debug);
}

controls.querySelector(".controls-toggle").addEventListener("click", () => {
  controls.classList.toggle("open");
});

// ------------------------------------------------------------------- start

renderTranscript();
renderVariantBar();
renderControls();
applySettings();

stage.addEventListener("pointerdown", onPointerDown);
stage.addEventListener("pointermove", onPointerMove);
stage.addEventListener("pointerup", onPointerUp);
stage.addEventListener("pointercancel", onPointerCancel);
stage.addEventListener("touchmove", onTouchMove, { passive: false });
window.addEventListener("resize", () => { closeSurface(); });

log(`${variant.title} \u00b7 ${window.innerWidth}\u00d7${window.innerHeight} css px`);
