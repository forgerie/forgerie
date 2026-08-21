// PROTOTYPE microphone: real capture, Smart Turn endpointing, real Whisper text.

import { checkTurn, transcribe } from "./api.js";
import { resumeContext } from "./audio.js";

const SAMPLE_RATE = 16000;
const BATCH_MS = 50;
const PRE_ROLL_BATCHES = 10;
const VOICED_RMS = 0.014;
const ECHO_RMS = 0.055;
const SPEECH_START_BATCHES = 4;
const PAUSE_MS = 650;
// Smart Turn can keep saying "not finished" forever. Silence still ends a turn.
const HARD_PAUSE_MS = 4000;
const MIN_NEW_VOICED_MS = 400;
const MIN_UTTERANCE_MS = 400;
const MAX_UTTERANCE_MS = 30000;
const TURN_WINDOW_SAMPLES = SAMPLE_RATE * 8;

export function createMic({
  isSpeaking = () => false,
  onLevel = () => {},
  onListening = () => {},
  onTranscript = () => {},
  onBargeIn = () => {},
  onError = () => {},
} = {}) {
  let stream;
  let context;
  let node;
  let handsFree = false;
  let holding = false;
  let enabled = false;
  let turnAvailable = true;

  const preRoll = [];
  let utterance = [];
  let utteranceSamples = 0;
  let speaking = false;
  let voicedRun = 0;
  let silenceMs = 0;
  let hardSilenceMs = 0;
  let voicedSinceCandidate = 0;
  let candidates = 0;
  let finalizing = false;

  function reset(clearPreRoll = false) {
    if (clearPreRoll) preRoll.length = 0;
    utterance = [];
    utteranceSamples = 0;
    speaking = false;
    voicedRun = 0;
    silenceMs = 0;
    hardSilenceMs = 0;
    voicedSinceCandidate = 0;
    candidates = 0;
    onListening(enabled ? (handsFree || holding ? "waiting" : "idle") : "off");
  }

  function collect() {
    const total = utterance.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Float32Array(total);
    let offset = 0;
    for (const chunk of utterance) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  function tail(samples, limit) {
    return samples.length <= limit ? samples : samples.subarray(samples.length - limit);
  }

  async function finalize(reason) {
    if (finalizing) return;
    const samples = collect();
    reset();
    if (samples.length < (SAMPLE_RATE * MIN_UTTERANCE_MS) / 1000) return;
    finalizing = true;
    onListening("transcribing");
    try {
      const text = await transcribe(samples);
      if (text.trim().length > 0) onTranscript(text.trim(), { reason });
    } catch (error) {
      onError(String(error?.message ?? error));
    } finally {
      finalizing = false;
      onListening(enabled ? (handsFree || holding ? "waiting" : "idle") : "off");
    }
  }

  async function considerEndpoint() {
    if (!turnAvailable) {
      await finalize("pause");
      return;
    }
    onListening("checking");
    try {
      const decision = await checkTurn(tail(collect(), TURN_WINDOW_SAMPLES));
      if (decision.complete) {
        await finalize("turn");
        return;
      }
      silenceMs = 0;
      voicedSinceCandidate = 0;
      onListening("hearing");
    } catch (error) {
      turnAvailable = false;
      onError(`turn detection unavailable: ${String(error?.message ?? error)}`);
      await finalize("pause");
    }
  }

  function accept({ samples, rms }) {
    onLevel(rms);
    const assistantSpeaking = isSpeaking();
    const threshold = assistantSpeaking ? ECHO_RMS : VOICED_RMS;
    const voiced = rms >= threshold;

    if (!handsFree && !holding) {
      preRoll.push(samples);
      while (preRoll.length > PRE_ROLL_BATCHES) preRoll.shift();
      return;
    }

    if (holding) {
      utterance.push(samples);
      utteranceSamples += samples.length;
      return;
    }

    if (!speaking) {
      preRoll.push(samples);
      while (preRoll.length > PRE_ROLL_BATCHES) preRoll.shift();
      voicedRun = voiced ? voicedRun + 1 : 0;
      if (voicedRun < SPEECH_START_BATCHES) return;
      if (assistantSpeaking) onBargeIn();
      speaking = true;
      silenceMs = 0;
      voicedSinceCandidate = 0;
      utterance = [...preRoll];
      utteranceSamples = utterance.reduce((sum, chunk) => sum + chunk.length, 0);
      preRoll.length = 0;
      onListening("hearing");
      return;
    }

    utterance.push(samples);
    utteranceSamples += samples.length;
    if (voiced) {
      silenceMs = 0;
      hardSilenceMs = 0;
      voicedSinceCandidate += BATCH_MS;
    } else {
      silenceMs += BATCH_MS;
      hardSilenceMs += BATCH_MS;
    }
    if (utteranceSamples >= (SAMPLE_RATE * MAX_UTTERANCE_MS) / 1000) {
      void finalize("limit");
      return;
    }
    if (hardSilenceMs >= HARD_PAUSE_MS) {
      void finalize("silence");
      return;
    }
    if (silenceMs >= PAUSE_MS && (candidates === 0 || voicedSinceCandidate >= MIN_NEW_VOICED_MS)) {
      silenceMs = 0;
      candidates += 1;
      void considerEndpoint();
    }
  }

  return {
    get enabled() {
      return enabled;
    },
    get handsFree() {
      return handsFree;
    },
    get turnAvailable() {
      return turnAvailable;
    },
    async enable() {
      if (enabled) return;
      if (navigator.mediaDevices?.getUserMedia === undefined) {
        throw new Error("this browser exposes no microphone");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      context = new AudioContext({ sampleRate: SAMPLE_RATE });
      if (!(await resumeContext(context, 500))) throw new Error("the browser suspended the audio context");
      await context.audioWorklet.addModule(new URL("./capture-worklet.js", import.meta.url));
      node = new AudioWorkletNode(context, "voice-content-capture", {
        processorOptions: { sourceSampleRateHz: context.sampleRate },
      });
      node.port.onmessage = (event) => {
        accept(event.data);
      };
      const source = context.createMediaStreamSource(stream);
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(node);
      node.connect(silent);
      silent.connect(context.destination);
      enabled = true;
      reset();
    },
    setHandsFree(value) {
      handsFree = value;
      reset(true);
    },
    holdStart() {
      if (!enabled) return;
      holding = true;
      utterance = [...preRoll];
      utteranceSamples = utterance.reduce((sum, chunk) => sum + chunk.length, 0);
      preRoll.length = 0;
      if (isSpeaking()) onBargeIn();
      onListening("hearing");
    },
    holdEnd() {
      if (!holding) return;
      holding = false;
      void finalize("release");
    },
    async disable() {
      enabled = false;
      handsFree = false;
      holding = false;
      if (node !== undefined) node.port.onmessage = null;
      node?.disconnect();
      for (const track of stream?.getAudioTracks() ?? []) track.stop();
      await context?.close().catch(() => undefined);
      stream = undefined;
      context = undefined;
      node = undefined;
      preRoll.length = 0;
      reset();
    },
  };
}
