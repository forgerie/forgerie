/**
 * PROTOTYPE — variant router.
 *
 * One route, four variations, switched by `?v=` and the floating bottom bar.
 * Nothing here is wired into the app and nothing persists.
 */

import * as context from "./variants/context.js";
import * as margin from "./variants/margin.js";
import * as sketch from "./variants/sketch.js";
import * as probe from "./variants/probe.js";

const VARIANTS = [context, margin, sketch, probe];

const stage = document.querySelector("#stage");
const bar = document.querySelector("#bar");
const hint = document.querySelector("#hint");
const armLamp = document.querySelector("#arm");
const toastNode = document.querySelector("#toast");

let cleanup = () => {};
let currentInk;
let touchDraws = false;
/**
 * "always" fixes the lost-first-stroke bug: ink is live at all times and the
 * finger scroll is hand-rolled. "hover" keeps the original arming experiment
 * so the two can be compared on the device.
 */
let scrollMode = "always";

const shared = {
  toast(text) {
    toastNode.textContent = text;
    toastNode.hidden = false;
    window.clearTimeout(shared.timer);
    shared.timer = window.setTimeout(() => {
      toastNode.hidden = true;
    }, 2200);
  },
  setArmed(armed) {
    if (shared.listening) return;
    armLamp.classList.toggle("on", armed);
    armLamp.textContent = armed ? (scrollMode === "always" ? "pen live" : "pen armed") : "waiting for the pen";
  },
  setListening(listening) {
    shared.listening = listening;
    armLamp.classList.toggle("listening", listening);
    if (listening) armLamp.textContent = "listening";
    else shared.setArmed(currentInk?.armed ?? false);
  },
  registerInk(ink) {
    currentInk = ink;
    ink.setTouchDraws(touchDraws);
    ink.setScrollMode(scrollMode);
    // Prototype-only handle so the headless check script can inspect strokes.
    window.__ink = ink;
  },
};

function selected() {
  const wanted = new URL(window.location.href).searchParams.get("v");
  return VARIANTS.find((variant) => variant.id === wanted) ?? VARIANTS[0];
}

function show(variant, push) {
  cleanup();
  currentInk = undefined;
  stage.innerHTML = "";
  shared.setArmed(false);
  hint.textContent = variant.hint;
  cleanup = variant.mount(stage, shared) ?? (() => {});
  for (const button of bar.querySelectorAll("[data-variant]")) {
    button.setAttribute("aria-pressed", String(button.dataset["variant"] === variant.id));
  }
  if (push) {
    const url = new URL(window.location.href);
    url.searchParams.set("v", variant.id);
    window.history.replaceState({}, "", url);
  }
}

for (const variant of VARIANTS) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset["variant"] = variant.id;
  button.textContent = variant.title;
  button.addEventListener("click", () => show(variant, true));
  bar.appendChild(button);
}

const modeToggle = document.createElement("button");
modeToggle.type = "button";
modeToggle.className = "toggle mode";
modeToggle.textContent = "scroll: manual";
modeToggle.title = "Compare the fixed model with the original hover-arming model";
modeToggle.addEventListener("click", () => {
  scrollMode = scrollMode === "always" ? "hover" : "always";
  modeToggle.textContent = `scroll: ${scrollMode === "always" ? "manual" : "native (hover arming)"}`;
  currentInk?.setScrollMode(scrollMode);
});
bar.appendChild(modeToggle);

const touchToggle = document.createElement("button");
touchToggle.type = "button";
touchToggle.className = "toggle";
touchToggle.textContent = "finger draws: off";
touchToggle.title = "Turn on when testing without a pen";
touchToggle.addEventListener("click", () => {
  touchDraws = !touchDraws;
  touchToggle.textContent = `finger draws: ${touchDraws ? "on" : "off"}`;
  touchToggle.setAttribute("aria-pressed", String(touchDraws));
  currentInk?.setTouchDraws(touchDraws);
});
bar.appendChild(touchToggle);

show(selected(), false);
