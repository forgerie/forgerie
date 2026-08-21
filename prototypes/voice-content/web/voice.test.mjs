import assert from "node:assert/strict";
import test from "node:test";

import { createVoice } from "./voice.js";

test("stop cancels pending synthesis before stale audio can start", async () => {
  const synthesis = deferred();
  const audio = recordingAudio();
  let requestSignal;
  const voice = createVoice({
    createContext: () => audio.context,
    synthesizeAudio: (_text, _voice, signal) => {
      requestSignal = signal;
      return synthesis.promise;
    },
  });

  const outcome = voice.say("obsolete line");
  voice.stop();
  synthesis.resolve(new ArrayBuffer(0));

  assert.equal(requestSignal?.aborted, true);
  assert.deepEqual(await outcome, { interrupted: true });
  assert.equal(audio.starts, 0);
});

test("replacing pending speech with the same text starts a new request", async () => {
  const firstSynthesis = deferred();
  const secondSynthesis = deferred();
  const syntheses = [firstSynthesis, secondSynthesis];
  const audio = recordingAudio();
  let calls = 0;
  const voice = createVoice({
    createContext: () => audio.context,
    synthesizeAudio: () => {
      const synthesis = syntheses[calls];
      calls += 1;
      if (synthesis === undefined) throw new Error("Unexpected synthesis request");
      return synthesis.promise;
    },
  });

  const first = voice.say("same line");
  const second = voice.say("same line");
  secondSynthesis.resolve(new ArrayBuffer(0));
  firstSynthesis.reject(new Error("aborted request completed late"));

  assert.equal(calls, 2);
  assert.deepEqual(await first, { interrupted: true });
  const secondSource = await waitForSource(audio.sources, 0);
  secondSource.onended?.();
  assert.deepEqual(await second, { interrupted: false });

  const third = voice.say("same line");
  const thirdSource = await waitForSource(audio.sources, 1);
  thirdSource.onended?.();
  assert.deepEqual(await third, { interrupted: false });
  assert.equal(calls, 2);
  assert.equal(audio.starts, 2);
});

function recordingAudio() {
  const sources = [];
  let starts = 0;
  const context = {
    state: "running",
    currentTime: 0,
    destination: {},
    decodeAudioData: async () => ({ duration: 1 }),
    createGain: () => ({
      gain: {
        value: 1,
        cancelScheduledValues: () => {},
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
      },
      connect: () => {},
    }),
    createBufferSource: () => {
      const source = {
        buffer: undefined,
        onended: null,
        connect: () => {},
        start: () => { starts += 1; },
        stop: () => {},
      };
      sources.push(source);
      return source;
    },
  };
  return {
    context,
    sources,
    get starts() {
      return starts;
    },
  };
}

async function waitForSource(sources, index) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (sources[index] !== undefined) return sources[index];
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Audio source was not created");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
