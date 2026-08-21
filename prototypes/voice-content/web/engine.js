// PROTOTYPE conversation engine.
//
// Owns the scripted run, the voice queue drain, and everything the user can do
// mid-run. The screen and the voice read the same state; they never read each
// other.

import { spellCount } from "./narrator.js";

const TICK_MS = 100;
const QUIET_BEFORE_PROGRESS_MS = 8000;
const DECISION_NUDGE_MS = 14000;

const BLOCK_NAMES = {
  say: "a note",
  tool: "a tool call",
  files: "a file list",
  table: "a table",
  diff: "a diff",
  error: "an error",
  question: "the choice",
  answer: "the summary",
  prompt: "your request",
};

export function createEngine({ voice, narrator }) {
  const listeners = new Set();
  const clock = createClock();
  let state = emptyState();
  let runToken = 0;
  let draining = false;
  let lastActAt = 0;
  let pendingAnswer;
  let decisionAskedAt = 0;

  function emit() {
    for (const listener of listeners) listener(state);
  }

  function patch(next) {
    state = { ...state, ...next };
    emit();
  }

  function addBlock(id, block, activity) {
    patch({
      blocks: [...state.blocks, { id, at: clock.elapsed, ...block }],
      activity: activity ?? (block.kind === "question" ? undefined : state.activity),
    });
  }

  function offer(say, refers, block) {
    const result = narrator.offer({
      ...say,
      refers,
      screenText: screenTextOf(block),
    });
    patch({ queued: narrator.pending, stats: { ...narrator.stats } });
    void drain();
    return result;
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const act = narrator.take();
        if (act === undefined) break;
        lastActAt = clock.elapsed;
        patch({
          speaking: act,
          attention: act.refers ?? state.attention,
          revealed: shouldReveal(act) && act.refers !== undefined
            ? [...new Set([...state.revealed, act.refers])]
            : state.revealed,
          queued: narrator.pending,
          stats: { ...narrator.stats },
        });
        const outcome = await voice.say(act.text);
        if (outcome.interrupted) narrator.clear();
        patch({ speaking: undefined, spokenLog: [...state.spokenLog, act].slice(-40), queued: narrator.pending });
      }
    } finally {
      draining = false;
    }
  }

  function tick() {
    if (!state.running || state.paused) return;
    const quiet = clock.elapsed - lastActAt;
    if (
      state.pending === undefined &&
      state.activity !== undefined &&
      quiet > QUIET_BEFORE_PROGRESS_MS &&
      narrator.pending === 0 &&
      !voice.speaking
    ) {
      lastActAt = clock.elapsed;
      offer({ type: "progress", text: `Still ${state.activity}.` }, undefined, undefined);
    }
    if (
      state.pending !== undefined &&
      decisionAskedAt > 0 &&
      clock.elapsed - decisionAskedAt > DECISION_NUDGE_MS &&
      narrator.pending === 0 &&
      !voice.speaking
    ) {
      decisionAskedAt = clock.elapsed;
      offer({ type: "decision", text: nudgeFor(state.pending) }, state.pending.blockId, undefined);
    }
  }

  const ticker = setInterval(tick, TICK_MS);

  async function sleepFor(ms, token) {
    const target = clock.elapsed + ms;
    while (clock.elapsed < target) {
      if (token !== runToken) return false;
      await pause(TICK_MS);
    }
    return token === runToken;
  }

  async function run(session, { speed = 1 } = {}) {
    const token = (runToken += 1);
    narrator.clear();
    voice.stop();
    clock.reset();
    lastActAt = 0;
    patch({
      ...emptyState(),
      sessionId: session.id,
      title: session.title,
      running: true,
      blocks: [{ id: "open", kind: "prompt", text: session.opening, at: 0 }],
    });

    for (const step of session.steps) {
      if (!(await sleepFor(step.after / speed, token))) return;
      if (step.block !== undefined) addBlock(step.id, step.block, step.activity);
      if (step.say !== undefined) offer(step.say, step.id, step.block);
      if (step.wait !== true) continue;

      patch({
        pending: { blockId: step.id, options: step.block?.options ?? [], text: step.block?.text ?? "" },
        activity: undefined,
      });
      decisionAskedAt = clock.elapsed;
      const chosen = await new Promise((resolve) => {
        pendingAnswer = resolve;
      });
      pendingAnswer = undefined;
      decisionAskedAt = 0;
      if (token !== runToken) return;
      const branch = step.answers?.[chosen] ?? Object.values(step.answers ?? {})[0];
      patch({ pending: undefined, decision: chosen });
      if (branch?.block !== undefined) addBlock(`${step.id}-answer`, branch.block, undefined);
      if (branch?.say !== undefined) narrator.clear();
      if (branch?.say !== undefined) offer(branch.say, `${step.id}-answer`, branch.block);
    }
    patch({ running: false, finished: true, activity: undefined });
  }

  function answer(optionId) {
    if (pendingAnswer === undefined) return false;
    const chosen = optionId ?? state.pending?.options?.[0]?.id;
    patch({
      userTurns: [...state.userTurns, { at: clock.elapsed, text: `[picked] ${labelFor(state.pending, chosen)}`, intent: "answer" }],
    });
    pendingAnswer(chosen);
    return true;
  }

  function say(type, text, refers) {
    narrator.interrupt({ type, text, refers });
    patch({ queued: narrator.pending });
    void drain();
  }

  function userSaid(text) {
    const intent = matchIntent(text, state.pending);
    patch({ userTurns: [...state.userTurns, { at: clock.elapsed, text, intent: intent.kind }].slice(-40) });
    switch (intent.kind) {
      case "answer":
        if (!answer(intent.option)) say("reply", "Nothing is waiting on you right now.");
        return intent;
      case "stop":
        clock.pause();
        voice.stop();
        narrator.clear();
        patch({ paused: true });
        say("reply", "Stopped. Say go on when you want me to carry on.");
        return intent;
      case "go":
        clock.resume();
        patch({ paused: false });
        say("reply", "Carrying on.");
        return intent;
      case "status":
        say("reply", recap(state));
        return intent;
      case "show":
        patch({ revealed: [...new Set([...state.revealed, latestContentBlock(state)?.id].filter(Boolean))] });
        say("reply", showLine(state));
        return intent;
      case "quiet":
        voice.setMuted(true);
        narrator.clear();
        patch({ muted: true });
        return intent;
      case "loud":
        voice.setMuted(false);
        patch({ muted: false });
        say("reply", "Back with you.");
        return intent;
      case "repeat":
        if (narrator.last !== undefined) say(narrator.last.type, narrator.last.text, narrator.last.refers);
        return intent;
      default:
        say("reply", state.pending !== undefined ? nudgeFor(state.pending) : ackLine(state));
        return intent;
    }
  }

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    run,
    answer,
    userSaid,
    say,
    bargeIn() {
      voice.stop();
      narrator.clear();
      patch({ speaking: undefined, queued: 0, bargeIns: state.bargeIns + 1 });
    },
    reveal(blockId) {
      patch({ revealed: [...new Set([...state.revealed, blockId])] });
    },
    setMuted(value) {
      voice.setMuted(value);
      patch({ muted: value });
    },
    togglePause() {
      if (state.paused) {
        clock.resume();
        patch({ paused: false });
      } else {
        clock.pause();
        voice.stop();
        patch({ paused: true });
      }
    },
    stop() {
      runToken += 1;
      voice.stop();
      narrator.clear();
      patch({ running: false, pending: undefined, activity: undefined });
    },
    dispose() {
      clearInterval(ticker);
    },
  };
}

function emptyState() {
  return {
    sessionId: undefined,
    title: "",
    blocks: [],
    running: false,
    paused: false,
    finished: false,
    muted: false,
    activity: undefined,
    attention: undefined,
    revealed: [],
    pending: undefined,
    decision: undefined,
    speaking: undefined,
    spokenLog: [],
    userTurns: [],
    queued: 0,
    bargeIns: 0,
    stats: { offered: 0, spoken: 0, merged: 0, dropped: 0, violations: 0 },
  };
}

function createClock() {
  let base = performance.now();
  let accumulated = 0;
  let paused = false;
  return {
    get elapsed() {
      return accumulated + (paused ? 0 : performance.now() - base);
    },
    pause() {
      if (paused) return;
      accumulated += performance.now() - base;
      paused = true;
    },
    resume() {
      if (!paused) return;
      base = performance.now();
      paused = false;
    },
    reset() {
      base = performance.now();
      accumulated = 0;
      paused = false;
    },
  };
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldReveal(act) {
  return act.type === "signpost" || act.type === "decision" || act.type === "land";
}

export function screenTextOf(block) {
  if (block === undefined) return undefined;
  return [
    block.text,
    block.title,
    block.target,
    ...(block.bullets ?? []),
    ...(block.items ?? []).map((item) => `${item.path} ${item.note ?? ""}`),
    ...(block.rows ?? []).flat(),
    ...(block.options ?? []).map((option) => `${option.label} ${option.detail ?? ""}`),
  ]
    .filter(Boolean)
    .join(" ");
}

function latestContentBlock(state) {
  return [...state.blocks].reverse().find((block) => block.kind !== "tool" && block.kind !== "prompt");
}

function labelFor(pending, optionId) {
  return pending?.options?.find((option) => option.id === optionId)?.label ?? optionId ?? "the first one";
}

function nudgeFor(pending) {
  const labels = (pending.options ?? []).map((option) => option.label.toLowerCase());
  if (labels.length < 2) return "Still waiting on you.";
  return `Still waiting. ${capitalize(labels[0])}, or ${labels[1]}?`;
}

function showLine(state) {
  const block = latestContentBlock(state);
  if (block === undefined) return "Nothing on screen yet.";
  return `${capitalize(BLOCK_NAMES[block.kind] ?? "it")} is up.`;
}

function ackLine(state) {
  if (state.activity !== undefined) return `Noted. I am still ${state.activity}.`;
  if (state.finished) return "Noted. I am finished for now.";
  return "Noted.";
}

/** Built from the streamed blocks, not from a script. This is the concept in one function. */
export function recap(state) {
  const counts = {};
  for (const block of state.blocks) {
    if (block.kind !== "tool") continue;
    counts[block.name] = (counts[block.name] ?? 0) + 1;
  }
  const parts = [];
  if (state.pending !== undefined) parts.push("Right now I am waiting on you.");
  else if (state.paused) parts.push("Right now I am stopped.");
  else if (state.activity !== undefined) parts.push(`Right now I am ${state.activity}.`);
  else if (state.finished) parts.push("I am finished.");
  else parts.push("Right now I am working.");

  const done = [];
  if (counts.read > 0) done.push(`read ${spellCount(counts.read)} ${counts.read === 1 ? "file" : "files"}`);
  if (counts.run > 0) done.push(`run the tests ${counts.run === 1 ? "once" : `${spellCount(counts.run)} times`}`);
  if (counts.fetch > 0) done.push("pulled the run list");
  if (done.length > 0) parts.push(`So far I have ${joinWords(done)}.`);

  const block = latestContentBlock(state);
  if (block !== undefined) parts.push(`The last thing on screen is ${BLOCK_NAMES[block.kind] ?? "a block"}.`);
  return parts.join(" ");
}

function joinWords(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const INTENT_PHRASES = [
  { kind: "quiet", phrases: ["stop talking", "stop narrating", "be quiet", "shut up", "quiet", "mute"] },
  { kind: "loud", phrases: ["talk to me", "start talking", "unmute", "speak up", "narrate"] },
  { kind: "status", phrases: ["what are you doing", "what is happening", "whats happening", "where are we", "catch me up", "recap", "status", "what now"] },
  { kind: "show", phrases: ["show me", "let me see", "show it", "on screen", "show the", "details"] },
  { kind: "repeat", phrases: ["say that again", "what did you say", "repeat that", "repeat", "again"] },
  { kind: "stop", phrases: ["hold on", "hang on", "wait", "stop", "pause"] },
  { kind: "go", phrases: ["go on", "keep going", "carry on", "continue", "resume", "go ahead", "carry"] },
];

const ORDINALS = [
  { index: 0, phrases: ["first", "one", "number one", "former", "top"] },
  { index: 1, phrases: ["second", "two", "number two", "latter", "bottom", "other"] },
];

export function matchIntent(rawText, pending) {
  const text = ` ${String(rawText ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;
  if (text.trim().length === 0) return { kind: "unknown" };

  if (pending !== undefined) {
    for (const option of pending.options ?? []) {
      for (const token of keywordsOf(option)) {
        if (text.includes(` ${token} `)) return { kind: "answer", option: option.id };
      }
    }
    for (const ordinal of ORDINALS) {
      const option = pending.options?.[ordinal.index];
      if (option === undefined) continue;
      for (const phrase of ordinal.phrases) {
        if (text.includes(` ${phrase} `)) return { kind: "answer", option: option.id };
      }
    }
    if (/ (do it|yes|yep|sure|go for it|please) /.test(text)) {
      return { kind: "answer", option: pending.options?.[0]?.id };
    }
  }

  const matches = [];
  for (const rule of INTENT_PHRASES) {
    for (const phrase of rule.phrases) {
      if (text.includes(` ${phrase} `)) matches.push({ kind: rule.kind, phrase });
    }
  }
  if (matches.length === 0) return { kind: "unknown" };
  matches.sort((left, right) => right.phrase.length - left.phrase.length);
  return { kind: matches[0].kind };
}

function keywordsOf(option) {
  const words = String(option.label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3);
  return [option.id.toLowerCase(), ...words];
}
