// PROTOTYPE voice output: real Kokoro audio, cached, interruptible inside ~70 ms.

import { synthesize } from "./api.js";
import { resumeContext } from "./audio.js";

const FADE_SECONDS = 0.06;

export function createVoice({
  onChange = () => {},
  synthesizeAudio = synthesize,
  createContext = () => new AudioContext(),
} = {}) {
  const cache = new Map();
  let context;
  let voiceName = "af_bella";
  let muted = false;
  let current;
  let pendingController;
  let pendingKey;
  let generation = 0;
  let speakingSince = 0;

  function ensureContext() {
    context ??= createContext();
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    return context;
  }

  async function load(text, signal) {
    const key = `${voiceName}:${text}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const pending = synthesizeAudio(text, voiceName, signal)
      .then((bytes) => ensureContext().decodeAudioData(bytes))
      .catch((error) => {
        if (cache.get(key) === pending) cache.delete(key);
        throw error;
      });
    cache.set(key, pending);
    return pending;
  }

  function stop() {
    generation += 1;
    pendingController?.abort();
    if (pendingKey !== undefined) cache.delete(pendingKey);
    pendingController = undefined;
    pendingKey = undefined;
    if (current === undefined) return;
    const stopping = current;
    current = undefined;
    speakingSince = 0;
    clearTimeout(stopping.guard);
    try {
      const now = stopping.context.currentTime;
      stopping.gain.gain.cancelScheduledValues(now);
      stopping.gain.gain.setValueAtTime(stopping.gain.gain.value, now);
      stopping.gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
      stopping.source.onended = null;
      stopping.source.stop(now + FADE_SECONDS + 0.01);
    } catch {
      // the source may already have ended
    }
    onChange({ speaking: false, text: "" });
    stopping.settle({ interrupted: true });
  }

  return {
    get muted() {
      return muted;
    },
    get speaking() {
      return current !== undefined;
    },
    get speakingForMs() {
      return speakingSince === 0 ? 0 : performance.now() - speakingSince;
    },
    setVoice(name) {
      voiceName = name;
    },
    setMuted(value) {
      muted = value;
      if (muted) stop();
    },
    unlock() {
      ensureContext();
    },
    prime(text) {
      if (typeof text === "string" && text.length > 0) void load(text).catch(() => undefined);
    },
    stop,
    async say(text) {
      if (muted || typeof text !== "string" || text.length === 0) return { interrupted: false, skipped: true };
      stop();
      const requestGeneration = generation;
      const controller = new AbortController();
      pendingController = controller;
      pendingKey = `${voiceName}:${text}`;
      let buffer;
      try {
        buffer = await load(text, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || requestGeneration !== generation) return { interrupted: true };
        onChange({ speaking: false, text: "", error: String(error) });
        return { interrupted: false, failed: true };
      } finally {
        if (pendingController === controller) {
          pendingController = undefined;
          pendingKey = undefined;
        }
      }
      if (muted || requestGeneration !== generation) return { interrupted: true };
      const audio = ensureContext();
      if (!(await resumeContext(audio))) {
        // Autoplay policy, no audio device, or a suspended tab. Never block the
        // conversation on it: the run must keep moving with the screen only.
        onChange({ speaking: false, text: "", blocked: true });
        return { interrupted: false, blocked: true };
      }
      if (muted || requestGeneration !== generation) return { interrupted: true };
      const gain = audio.createGain();
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(audio.destination);
      return new Promise((resolve) => {
        let settled = false;
        const settle = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        // The guard covers a context that stops advancing mid-line, which would
        // otherwise leave onended unfired and the queue stuck behind it.
        const guard = setTimeout(() => {
          if (current?.source !== source) return;
          current = undefined;
          speakingSince = 0;
          onChange({ speaking: false, text: "" });
          settle({ interrupted: false, guarded: true });
        }, buffer.duration * 1000 + 750);
        current = { source, gain, context: audio, settle, guard };
        speakingSince = performance.now();
        source.onended = () => {
          if (current?.source !== source) return;
          clearTimeout(guard);
          current = undefined;
          speakingSince = 0;
          onChange({ speaking: false, text: "" });
          settle({ interrupted: false });
        };
        onChange({ speaking: true, text });
        source.start();
      });
    },
  };
}
