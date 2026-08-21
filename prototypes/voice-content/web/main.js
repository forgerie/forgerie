// PROTOTYPE bootstrap: chrome, variant switching, and the wiring between the
// microphone, the narrator, the engine, and whichever variant is mounted.

import { getStatus } from "./api.js";
import { el, setFlag } from "./dom.js";
import { createEngine } from "./engine.js";
import { createMic } from "./mic.js";
import { createNarrator } from "./narrator.js";
import { createProbe } from "./probe.js";
import { SESSIONS, sessionById } from "./sessions.js";
import { createVoice } from "./voice.js";
import { ambient } from "./variants/ambient.js";
import { deck } from "./variants/deck.js";
import { follow } from "./variants/follow.js";

const VARIANTS = [follow, deck, ambient];
const MIC_MODES = ["off", "hold", "hands-free"];
const PARAMS = new URL(window.location.href).searchParams;

const ui = {
  variant: readVariant(),
  micMode: PARAMS.has("nomic") ? "off" : (MIC_MODES.includes(PARAMS.get("mic")) ? PARAMS.get("mic") : "hold"),
  captions: PARAMS.has("captions"),
  screenOn: true,
  listening: "off",
  status: undefined,
  notice: "",
  heard: "",
};

const narrator = createNarrator();
const voice = createVoice({
  onChange: (change) => {
    if (change.blocked === true) notice("the browser blocked audio; press start, then try again");
    if (change.error !== undefined) notice(change.error);
    render();
  },
});
const engine = createEngine({ voice, narrator });
const mic = createMic({
  isSpeaking: () => voice.speaking,
  onLevel: (rms) => {
    document.documentElement.style.setProperty("--mic-level", String(Math.min(1, rms * 14)));
  },
  onListening: (value) => {
    ui.listening = value;
    render();
  },
  onTranscript: (text) => {
    ui.heard = text;
    engine.userSaid(text);
    render();
  },
  onBargeIn: () => engine.bargeIn(),
  onError: (message) => notice(message),
});

const stage = document.querySelector("#stage");
const chrome = buildChrome();
const probe = createProbe(document.body, { narrator });
let mounted;
let engineState = engine.state;

engine.subscribe((state) => {
  engineState = state;
  render();
});

document.body.classList.toggle("bare", PARAMS.has("bare"));
if (PARAMS.has("mute")) engine.setMuted(true);
mountVariant(ui.variant);
if (PARAMS.has("probe")) probe.toggle(view());
render();
void boot();

async function boot() {
  try {
    ui.status = await getStatus();
    if (ui.status.stt !== "ready" || ui.status.tts !== "ready") notice("a speech worker is not ready; check the server log");
    else if (ui.status.turn !== "ready") notice("turn detection is unavailable; pauses will end your turn");
  } catch (error) {
    notice(`speech process unreachable: ${String(error?.message ?? error)}`);
  }
  render();
  if (PARAMS.has("autostart")) await start(PARAMS.get("session") ?? SESSIONS[0].id);
}

function view() {
  return { ...engineState, ...ui };
}

function render() {
  chrome.update(view());
  mounted?.update(view());
  probe.update(view());
  setFlag(document.body, "screen-off", !ui.screenOn);
}

function mountVariant(id) {
  const next = VARIANTS.find((variant) => variant.id === id) ?? VARIANTS[0];
  ui.variant = next.id;
  stage.replaceChildren();
  mounted = next;
  mounted.mount(stage, { engine });
  document.body.dataset.variant = next.id;
  const url = new URL(window.location.href);
  url.searchParams.set("variant", next.id);
  window.history.replaceState({}, "", url);
  render();
}

function cycleVariant(direction) {
  const index = VARIANTS.findIndex((variant) => variant.id === ui.variant);
  const next = VARIANTS[(index + direction + VARIANTS.length) % VARIANTS.length];
  mountVariant(next.id);
}

function notice(message) {
  ui.notice = message;
  render();
  window.setTimeout(() => {
    if (ui.notice !== message) return;
    ui.notice = "";
    render();
  }, 6000);
}

async function start(sessionId) {
  voice.unlock();
  if (ui.micMode !== "off") {
    try {
      await mic.enable();
      mic.setHandsFree(ui.micMode === "hands-free");
    } catch (error) {
      await mic.disable();
      ui.micMode = "off";
      notice(`microphone unavailable: ${String(error?.message ?? error)}`);
    }
  }
  void engine.run(sessionById(sessionId), { speed: Number(PARAMS.get("speed") ?? 1) || 1 });
}

async function setMicMode(mode) {
  ui.micMode = mode;
  render();
  try {
    if (mode === "off") {
      await mic.disable();
    } else {
      await mic.enable();
      mic.setHandsFree(mode === "hands-free");
    }
  } catch (error) {
    await mic.disable();
    ui.micMode = "off";
    notice(`microphone unavailable: ${String(error?.message ?? error)}`);
  }
  render();
}

function buildChrome() {
  const sessionSelect = el(
    "select",
    { class: "control", onchange: (event) => start(event.target.value) },
    ...SESSIONS.map((session) =>
      el("option", { value: session.id, text: session.title, selected: session.id === PARAMS.get("session") }),
    ),
  );
  const startButton = el("button", { class: "control primary", type: "button", text: "start", onclick: () => start(sessionSelect.value) });
  const pauseButton = el("button", { class: "control", type: "button", text: "hold", onclick: () => engine.togglePause() });
  const muteButton = el("button", { class: "control", type: "button", text: "voice on", onclick: () => engine.setMuted(!engineState.muted) });
  const micButton = el("button", {
    class: "control mic",
    type: "button",
    text: "hold to talk",
    onpointerdown: () => mic.holdStart(),
    onpointerup: () => mic.holdEnd(),
    onpointerleave: () => mic.holdEnd(),
  });
  const micModeButton = el("button", {
    class: "control",
    type: "button",
    onclick: () => { void setMicMode(MIC_MODES[(MIC_MODES.indexOf(ui.micMode) + 1) % MIC_MODES.length]); },
  });
  const screenButton = el("button", {
    class: "control",
    type: "button",
    onclick: () => {
      ui.screenOn = !ui.screenOn;
      render();
    },
  });
  const captionButton = el("button", {
    class: "control",
    type: "button",
    onclick: () => {
      ui.captions = !ui.captions;
      render();
    },
  });
  const probeButton = el("button", { class: "control", type: "button", text: "probe", onclick: () => probe.toggle(view()) });
  const typed = el("input", {
    class: "typed",
    type: "text",
    placeholder: "type what you would say, then enter",
    onkeydown: (event) => {
      if (event.key !== "Enter") return;
      const text = event.target.value.trim();
      if (text.length === 0) return;
      event.target.value = "";
      ui.heard = text;
      engine.userSaid(text);
      render();
    },
  });

  const heard = el("div", { class: "heard" });
  const noticeLine = el("div", { class: "notice" });
  const state = el("div", { class: "state" });

  const bar = el(
    "header",
    { class: "bar" },
    el("div", { class: "bar-group" }, sessionSelect, startButton, pauseButton),
    el("div", { class: "bar-group" }, micButton, micModeButton, muteButton),
    el("div", { class: "bar-group" }, screenButton, captionButton, probeButton),
    state,
  );

  const switcher = el(
    "nav",
    { class: "switcher" },
    el("button", { class: "switch-step", type: "button", text: "‹", onclick: () => cycleVariant(-1) }),
    el("span", { class: "switch-label" }),
    el("button", { class: "switch-step", type: "button", text: "›", onclick: () => cycleVariant(1) }),
  );

  const foot = el("div", { class: "foot" }, typed, heard, noticeLine);
  document.body.append(bar, foot, switcher, el("div", { class: "screen-off-hint", text: "screen off · voice only · press h" }));

  return {
    update(current) {
      startButton.textContent = current.running ? "restart" : "start";
      pauseButton.textContent = current.paused ? "carry on" : "hold";
      pauseButton.disabled = !current.running;
      muteButton.textContent = current.muted ? "voice off" : "voice on";
      setFlag(muteButton, "is-off", current.muted);
      micModeButton.textContent = `mic: ${current.micMode}`;
      micButton.disabled = current.micMode === "off";
      setFlag(micButton, "is-live", current.listening === "hearing" || current.listening === "checking");
      screenButton.textContent = current.screenOn ? "screen on" : "screen off";
      captionButton.textContent = current.captions ? "captions on" : "captions off";
      state.textContent = stateLine(current);
      heard.textContent = current.heard ? `heard: ${current.heard}` : "";
      noticeLine.textContent = current.notice;
      setFlag(noticeLine, "is-shown", current.notice.length > 0);
      const variant = VARIANTS.find((entry) => entry.id === current.variant);
      switcher.querySelector(".switch-label").textContent = `${variant?.name ?? ""} — ${variant?.hint ?? ""}`;
    },
  };
}

function stateLine(current) {
  const bits = [];
  if (current.speaking !== undefined) bits.push("speaking");
  else if (current.queued > 0) bits.push(`${current.queued} queued`);
  if (current.listening !== "off" && current.listening !== "idle") bits.push(current.listening);
  if (current.pending !== undefined) bits.push("your call");
  if (current.paused) bits.push("held");
  return bits.join(" · ");
}

function readVariant() {
  const fromQuery = new URL(window.location.href).searchParams.get("variant");
  const fromHash = window.location.hash.replace("#", "");
  return VARIANTS.some((variant) => variant.id === fromHash) ? fromHash : fromQuery ?? "follow";
}

// Prototype hook: poke at the run from the browser console.
window.__voiceContent = { engine, voice, mic, narrator, view };

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === "ArrowRight") cycleVariant(1);
  else if (event.key === "ArrowLeft") cycleVariant(-1);
  else if (event.key === "h") {
    ui.screenOn = !ui.screenOn;
    render();
  } else if (event.key === "m") engine.setMuted(!engineState.muted);
  else if (event.key === "p") probe.toggle(view());
  else if (event.key === " " && !event.repeat && ui.micMode !== "off") {
    event.preventDefault();
    mic.holdStart();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === " " && ui.micMode !== "off") mic.holdEnd();
});
