#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#espeak-ng -c node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import os from "node:os";
import { performance } from "node:perf_hooks";
import readline from "node:readline";

const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 4;
const DEFAULT_DURATIONS = [3, 10, 30, 60];
const DEFAULT_REPEATS = 20;
const SMART_TURN_PROTOCOL = "forgerie-smart-turn-worker-v1";
const WARMUP_TIMEOUT_MS = 120_000;
const INFERENCE_TIMEOUT_MS = 120_000;
const SAMPLE_INTERVAL_MS = 25;
const WORKLOAD_UNITS = ["forgerie-sessiond.service", "forgerie-web.service"];

const args = parseArgs(process.argv.slice(2));
const durations = args.durations ?? DEFAULT_DURATIONS;
const repeats = args.repeats ?? DEFAULT_REPEATS;
const contentionRepeats = args.contentionRepeats ?? repeats;
const cwd = process.cwd();
const tempPaths = [];

const result = {
  measuredAt: new Date().toISOString(),
  host: {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  },
  policyInputs: {
    sampleRateHz: SAMPLE_RATE,
    bytesPerSample: BYTES_PER_SAMPLE,
    durationsSeconds: durations,
    repeatedTurns: repeats,
    contentionTurns: contentionRepeats,
    maxTurnBytes: secondsToBytes(Math.max(...durations)),
    endpointWindowBytes: secondsToBytes(8),
    fixtureKind: "generated-non-sensitive-tts-speech",
  },
  realization: {},
  fixtureGeneration: {},
  activeAgentWorkload: {},
  smartTurn: {},
  whisper: {},
  contention: {},
  cancellation: {},
  restart: {},
  persistentWarmth: {},
  observations: [],
  evidenceGaps: [],
};

let smartTurnProcess;
let whisperProcess;
let workloadMonitor;

void main();

async function main() {
  try {
    workloadMonitor = await startWorkloadMonitor(WORKLOAD_UNITS);
    const smartTurnPackage = await timed("nix build Smart Turn package", () => nixBuild("forgerie-smart-turn-worker"));
    result.realization.smartTurn = smartTurnPackage.measurement;
    const whisperPackage = await timed("nix build Whisper package", () => nixBuild("forgerie-whisper-stt-server"));
    result.realization.whisper = whisperPackage.measurement;

    const smartTurnCommand = `${smartTurnPackage.value}/bin/forgerie-smart-turn-worker`;
    const whisperCommand = `${whisperPackage.value}/bin/forgerie-whisper-stt-server`;

    const fixtures = await generateTtsFixtures(durations);
    result.fixtureGeneration = {
      kind: "generated-non-sensitive-tts-speech",
      durationsSeconds: durations,
      samples: Object.fromEntries([...fixtures].map(([seconds, samples]) => [String(seconds), samples.length])),
      transientFilesDeleted: false,
    };

    const smartStart = performance.now();
    smartTurnProcess = spawnRuntime(smartTurnCommand, []);
    const smartLines = new LineReader(smartTurnProcess.child.stdout);
    const smartReady = await smartLines.nextJson(WARMUP_TIMEOUT_MS);
    assertReadyRecord(smartReady);
    result.smartTurn.coldReady = await finishProcessMeasurement(smartStart, [process.pid, smartTurnProcess.child.pid]);

    result.smartTurn.firstInference = await measureProcessOperation([process.pid, smartTurnProcess.child.pid], async () => smartTurnRequest(smartTurnProcess.child, smartLines, fixtures.get(durations[0]), "smart-first"));
    result.smartTurn.fixtures = [];
    for (const seconds of durations) {
      result.smartTurn.fixtures.push({ seconds, ...(await measureProcessOperation([process.pid, smartTurnProcess.child.pid], async () => smartTurnRequest(smartTurnProcess.child, smartLines, fixtures.get(seconds), `smart-${String(seconds)}`))) });
    }
    result.smartTurn.repeatedThreeSecondTurns = await repeatedMeasurements(repeats, [process.pid, smartTurnProcess.child.pid], async (index) => smartTurnRequest(smartTurnProcess.child, smartLines, fixtures.get(3), `smart-repeat-${String(index)}`));

    const whisperPort = 18_000 + (process.pid % 10_000);
    const whisperStart = performance.now();
    whisperProcess = spawnRuntime(whisperCommand, [String(whisperPort)]);
    await waitForTcp("127.0.0.1", whisperPort, WARMUP_TIMEOUT_MS);
    result.whisper.tcpReady = await finishProcessMeasurement(whisperStart, [process.pid, whisperProcess.child.pid]);

    result.whisper.firstInference = await measureProcessOperation([process.pid, whisperProcess.child.pid], async () => whisperRequest(whisperPort, fixtures.get(durations[0]), "whisper-first"));
    result.whisper.readyAfterRepresentativeInferenceMs = result.whisper.tcpReady.elapsedMs + result.whisper.firstInference.elapsedMs;
    result.whisper.fixtures = [];
    for (const seconds of durations) {
      result.whisper.fixtures.push({ seconds, ...(await measureProcessOperation([process.pid, whisperProcess.child.pid], async () => whisperRequest(whisperPort, fixtures.get(seconds), `whisper-${String(seconds)}`))) });
    }
    result.whisper.repeatedThreeSecondTurns = await repeatedMeasurements(repeats, [process.pid, whisperProcess.child.pid], async (index) => whisperRequest(whisperPort, fixtures.get(3), `whisper-repeat-${String(index)}`));

    result.contention.whisperActivePlusQueued = await repeatedContentionMeasurements({
      repeats: contentionRepeats,
      pids: [process.pid, smartTurnProcess.child.pid, whisperProcess.child.pid],
      smartChild: smartTurnProcess.child,
      smartLines,
      whisperPort,
      activeSamples: fixtures.get(Math.min(30, Math.max(...durations))) ?? fixtures.get(durations[0]),
      queuedSamples: fixtures.get(10) ?? fixtures.get(durations[0]),
      endpointSamples: fixtures.get(8) ?? fixtures.get(durations[0]),
    });

    result.cancellation.queuedWhisperClientAbort = await observeQueuedWhisperAbort(whisperPort, fixtures.get(30) ?? fixtures.get(durations.at(-1)), fixtures.get(10) ?? fixtures.get(durations[0]));
    result.cancellation.activeWhisperClientAbort = await observeWhisperAbort(whisperPort, fixtures.get(Math.max(...durations)), fixtures.get(3));
    result.cancellation.forcedWhisperTermination = await observeForcedWhisperTermination(whisperCommand, whisperPort + 1, fixtures.get(30) ?? fixtures.get(durations.at(-1)), fixtures.get(3));
    result.restart.smartTurn = await restartSmartTurn(smartTurnCommand);
    await stopRuntime(smartTurnProcess);
    smartTurnProcess = result.restart.smartTurn.runtime;
    result.restart.smartTurn.runtime = "restarted";
    result.restart.whisper = await restartWhisper(whisperCommand, whisperPort + 2, fixtures.get(3));
    await stopRuntime(whisperProcess);
    whisperProcess = result.restart.whisper.runtime;
    result.restart.whisper.runtime = "restarted";

    result.activeAgentWorkload = await workloadMonitor.stop();
    workloadMonitor = undefined;
    result.persistentWarmth = persistentWarmthDecision(result);

    result.observations.push("Whisper fixtures are generated non-sensitive TTS speech and are deleted before successful process exit. Recognized transcript text is never printed in this output.");
    result.observations.push("Operation measurements sample the benchmark Node process and child process trees during work, so PCM/WAV/body copy pressure can contribute to peak RSS.");
    result.evidenceGaps.push("Physical Fold microphone quality, Android thermal behavior, and foreground lifecycle still belong to U10/U8.");
    result.evidenceGaps.push("Queued cancellation through a future one-active/one-queued adapter remains adapter-only proof for U2; this script can only abort direct Whisper HTTP clients and observe direct runtime recovery.");
    result.evidenceGaps.push("Hard-deadline child termination policy still needs U2 adapter tests for a deliberately wedged inference; this script proves direct child termination and restart timing against the real runtime.");

    await cleanupTempFiles();
    result.fixtureGeneration.transientFilesDeleted = true;
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (workloadMonitor !== undefined) {
      result.activeAgentWorkload = await workloadMonitor.stop().catch((monitorError) => ({ measurementAvailable: false, failure: sanitizeError(monitorError) }));
      workloadMonitor = undefined;
    }
    await cleanupTempFiles();
    result.fixtureGeneration.transientFilesDeleted = true;
    result.failure = sanitizeError(error);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([stopRuntime(smartTurnProcess), stopRuntime(whisperProcess)]);
    await cleanupTempFiles();
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (arg.startsWith("--durations=")) {
      parsed.durations = arg.slice("--durations=".length).split(",").map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0);
    } else if (arg.startsWith("--repeats=")) {
      const repeatsValue = Number(arg.slice("--repeats=".length));
      if (Number.isInteger(repeatsValue) && repeatsValue > 0) parsed.repeats = repeatsValue;
    } else if (arg.startsWith("--contention-repeats=")) {
      const repeatsValue = Number(arg.slice("--contention-repeats=".length));
      if (Number.isInteger(repeatsValue) && repeatsValue > 0) parsed.contentionRepeats = repeatsValue;
    }
  }
  return parsed;
}

function secondsToBytes(seconds) {
  return Math.round(seconds * SAMPLE_RATE * BYTES_PER_SAMPLE);
}

async function generateTtsFixtures(requestedDurations) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-speech-benchmark-"));
  tempPaths.push(root);
  const baseWav = join(root, "tts-source.wav");
  await run("espeak-ng", ["-v", "en-us", "-s", "145", "-p", "45", "-w", baseWav, benchmarkSpeechPrompt()], { timeoutMs: 60_000 });
  const source = resampleTo16k(await decodePcm16Wav(baseWav));
  const fixtures = new Map();
  for (const seconds of requestedDurations) fixtures.set(seconds, stretchOrTrimSpeech(source, seconds));
  if (!fixtures.has(8)) fixtures.set(8, stretchOrTrimSpeech(source, 8));
  return fixtures;
}

function benchmarkSpeechPrompt() {
  return [
    "Forgerie records this generated voice only as a temporary benchmark fixture.",
    "The words are ordinary test speech and do not contain private data.",
    "This sentence includes short pauses, numbers like seven and twenty four, and varied sounds for transcription work.",
    "The local model should process a complete bounded turn while the benchmark records timing and memory only.",
  ].join(" ");
}

async function decodePcm16Wav(path) {
  const buffer = await readFile(path);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("TTS did not produce a RIFF/WAVE file");
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === "fmt ") {
      const format = buffer.readUInt16LE(chunkStart);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
      if (format !== 1 || bitsPerSample !== 16) throw new Error("TTS WAV must be 16-bit PCM");
    } else if (chunkId === "data") {
      dataStart = chunkStart;
      dataSize = chunkSize;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (channels < 1 || sampleRate <= 0 || dataStart < 0 || dataSize <= 0) throw new Error("TTS WAV is missing fmt/data chunks");
  const frames = Math.floor(dataSize / (channels * 2));
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) sum += buffer.readInt16LE(dataStart + (frame * channels + channel) * 2) / 32768;
    samples[frame] = sum / channels;
  }
  return { sampleRate, samples };
}

function resampleTo16k(source) {
  if (source.sampleRate === SAMPLE_RATE) return source.samples;
  const targetLength = Math.max(1, Math.round(source.samples.length * SAMPLE_RATE / source.sampleRate));
  const target = new Float32Array(targetLength);
  const ratio = source.sampleRate / SAMPLE_RATE;
  for (let index = 0; index < target.length; index += 1) {
    const sourcePosition = index * ratio;
    const left = Math.floor(sourcePosition);
    const right = Math.min(source.samples.length - 1, left + 1);
    const fraction = sourcePosition - left;
    target[index] = (source.samples[left] ?? 0) * (1 - fraction) + (source.samples[right] ?? 0) * fraction;
  }
  return target;
}

function stretchOrTrimSpeech(source, seconds) {
  const targetLength = Math.round(seconds * SAMPLE_RATE);
  const gap = Math.round(0.18 * SAMPLE_RATE);
  const target = new Float32Array(targetLength);
  let offset = 0;
  while (offset < targetLength) {
    const copy = Math.min(source.length, targetLength - offset);
    target.set(source.subarray(0, copy), offset);
    offset += copy + gap;
  }
  const fadeLength = Math.min(Math.round(0.05 * SAMPLE_RATE), target.length);
  for (let index = 0; index < fadeLength; index += 1) {
    const factor = index / fadeLength;
    target[index] *= factor;
    target[target.length - 1 - index] *= factor;
  }
  return target;
}

async function cleanupTempFiles() {
  await Promise.allSettled(tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
}

async function nixBuild(attribute) {
  const completed = await run("nix", ["build", `.#${attribute}`, "--no-link", "--print-out-paths"], { timeoutMs: 600_000 });
  const lines = completed.stdout.trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length === 0) throw new Error(`nix build did not report an output for ${attribute}`);
  return lines[lines.length - 1];
}

async function timed(name, action) {
  const started = performance.now();
  const value = await action();
  return { value, measurement: { name, elapsedMs: elapsedSince(started) } };
}

function spawnRuntime(command, runtimeArgs) {
  const child = spawn(command, runtimeArgs, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: minimalEnv(),
  });
  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr.push(String(chunk).slice(0, 500));
    if (stderr.length > 8) stderr.shift();
  });
  child.on("error", () => undefined);
  return { child, stderr };
}

function minimalEnv() {
  const next = { PATH: process.env.PATH ?? "" };
  if (process.env.NIX_SSL_CERT_FILE !== undefined) next.NIX_SSL_CERT_FILE = process.env.NIX_SSL_CERT_FILE;
  if (process.env.SSL_CERT_FILE !== undefined) next.SSL_CERT_FILE = process.env.SSL_CERT_FILE;
  return next;
}

class LineReader {
  constructor(stream) {
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    this.readline = readline.createInterface({ input: stream });
    this.readline.on("line", (line) => this.push(line));
    this.readline.on("close", () => this.close());
  }

  push(line) {
    const waiter = this.waiters.shift();
    if (waiter === undefined) this.queue.push(line);
    else waiter.resolve(line);
  }

  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.reject(new Error("runtime stdout closed"));
  }

  async nextJson(timeoutMs) {
    const line = await this.nextLine(timeoutMs);
    const parsed = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("runtime emitted non-object JSON");
    return parsed;
  }

  nextLine(timeoutMs) {
    const line = this.queue.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.closed) return Promise.reject(new Error("runtime stdout closed"));
    return withTimeout(new Promise((resolve, reject) => this.waiters.push({ resolve, reject })), timeoutMs, "runtime line timeout");
  }
}

function assertReadyRecord(record) {
  if (record.status !== "ready" || record.protocol !== SMART_TURN_PROTOCOL) throw new Error("Smart Turn worker did not emit the expected ready record");
}

async function smartTurnRequest(child, lines, samples, requestId) {
  const raw = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  child.stdin.write(`${JSON.stringify({ protocol: SMART_TURN_PROTOCOL, requestId, audio: raw.toString("base64") })}\n`);
  const response = await lines.nextJson(INFERENCE_TIMEOUT_MS);
  if (response.requestId !== requestId) throw new Error("Smart Turn response ID mismatch");
  if (response.status !== "ready") throw new Error("Smart Turn request failed");
  return {
    requestIdMatched: true,
    complete: response.complete === true,
    probability: typeof response.probability === "number" ? response.probability : null,
    samples: typeof response.samples === "number" ? response.samples : samples.length,
  };
}

async function whisperRequest(port, samples, label, signal) {
  const before = process.memoryUsage();
  const wav = wavFromFloat32(samples);
  const afterWav = process.memoryUsage();
  const form = new FormData();
  form.set("file", new Blob([wav], { type: "audio/wav" }), `${label}.wav`);
  form.set("response_format", "json");
  const afterBody = process.memoryUsage();
  const response = await withTimeout(fetch(`http://127.0.0.1:${String(port)}/inference`, { method: "POST", body: form, signal }), INFERENCE_TIMEOUT_MS, "Whisper inference timeout");
  const body = await response.text();
  const afterResponse = process.memoryUsage();
  if (!response.ok) throw new Error(`Whisper inference failed with HTTP ${String(response.status)}`);
  let responseKind = "text";
  try {
    JSON.parse(body);
    responseKind = "json";
  } catch {
    responseKind = "text";
  }
  return {
    responseKind,
    responseBytes: Buffer.byteLength(body),
    copyPressure: {
      pcmBytes: samples.byteLength,
      wavBytes: wav.byteLength,
      rssBeforeBytes: before.rss,
      rssAfterWavBytes: afterWav.rss,
      rssAfterBodyBytes: afterBody.rss,
      rssAfterResponseBytes: afterResponse.rss,
      peakNodeCopyRssBytes: Math.max(before.rss, afterWav.rss, afterBody.rss, afterResponse.rss),
      heapUsedDeltaBytes: Math.max(0, afterBody.heapUsed - before.heapUsed),
      externalDeltaBytes: Math.max(0, afterBody.external - before.external),
    },
  };
}

function wavFromFloat32(samples) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + index * 2);
  }
  return buffer;
}

async function repeatedMeasurements(count, pids, operation) {
  const iterations = [];
  for (let index = 0; index < count; index += 1) iterations.push(await measureProcessOperation(pids, async () => operation(index)));
  return summarizeIterations(iterations);
}

async function repeatedContentionMeasurements(options) {
  const iterations = [];
  for (let index = 0; index < options.repeats; index += 1) {
    iterations.push(await measureProcessOperation(options.pids, async () => {
      const active = whisperRequest(options.whisperPort, options.activeSamples, `whisper-contention-active-${String(index)}`);
      await delay(75);
      const queued = whisperRequest(options.whisperPort, options.queuedSamples, `whisper-contention-queued-${String(index)}`);
      await delay(75);
      const endpoint = await smartTurnRequest(options.smartChild, options.smartLines, options.endpointSamples, `smart-contention-${String(index)}`);
      const [activeResult, queuedResult] = await Promise.all([active, queued]);
      return { endpoint, activeResponseBytes: activeResult.responseBytes, queuedResponseBytes: queuedResult.responseBytes };
    }));
  }
  return summarizeIterations(iterations);
}

function summarizeIterations(iterations) {
  const elapsed = iterations.map((iteration) => iteration.elapsedMs).sort((left, right) => left - right);
  const afterRss = iterations.map((iteration) => iteration.after.rssBytes);
  const peakRss = iterations.map((iteration) => iteration.peak.rssBytes);
  const peakCpu = iterations.map((iteration) => iteration.peak.cpuPercent).sort((left, right) => left - right);
  return {
    count: iterations.length,
    elapsedMs: {
      min: elapsed[0] ?? 0,
      max: elapsed[elapsed.length - 1] ?? 0,
      p50: percentile(elapsed, 0.5),
      p95: percentile(elapsed, 0.95),
    },
    rssBytes: {
      firstAfter: afterRss[0] ?? 0,
      lastAfter: afterRss[afterRss.length - 1] ?? 0,
      maxAfter: Math.max(0, ...afterRss),
      maxSampledPeak: Math.max(0, ...peakRss),
    },
    cpuPercent: {
      peakP95: percentile(peakCpu, 0.95),
      peakMax: Math.max(0, ...peakCpu),
    },
  };
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

async function measureProcessOperation(pids, operation) {
  const before = await processTreeSnapshot(pids);
  const samples = [before];
  const started = performance.now();
  const timer = setInterval(() => {
    void processTreeSnapshot(pids).then((snapshot) => samples.push(snapshot)).catch(() => undefined);
  }, SAMPLE_INTERVAL_MS);
  try {
    const value = await operation();
    clearInterval(timer);
    const after = await processTreeSnapshot(pids);
    samples.push(after);
    const elapsedMs = elapsedSince(started);
    return { elapsedMs, cpuPercent: cpuPercent(before, after, elapsedMs), peak: peakSnapshot(samples), before, after, value };
  } catch (error) {
    clearInterval(timer);
    throw error;
  }
}

async function finishProcessMeasurement(started, pids) {
  const snapshot = await processTreeSnapshot(pids);
  return { elapsedMs: elapsedSince(started), pids: snapshot.pids, rssBytes: snapshot.rssBytes };
}

function peakSnapshot(samples) {
  let peak = samples[0] ?? { rssBytes: 0, cpuJiffies: 0, sampledAtMs: performance.now() };
  for (const sample of samples) if (sample.rssBytes > peak.rssBytes) peak = sample;
  let cpuPeak = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const elapsedMs = Math.max(1, current.sampledAtMs - previous.sampledAtMs);
    cpuPeak = Math.max(cpuPeak, cpuPercent(previous, current, elapsedMs));
  }
  return { ...peak, cpuPercent: Number(cpuPeak.toFixed(2)) };
}

async function processTreeSnapshot(rootPids) {
  const pids = new Set();
  for (const rootPid of rootPids) if (typeof rootPid === "number") await collectProcessTree(rootPid, pids);
  let rssBytes = 0;
  let cpuJiffies = 0;
  for (const pid of pids) {
    const metrics = await readProcessMetrics(pid);
    rssBytes += metrics.rssBytes;
    cpuJiffies += metrics.cpuJiffies;
  }
  return { sampledAtMs: performance.now(), pids: [...pids].sort((left, right) => left - right), rssBytes, cpuJiffies };
}

async function collectProcessTree(pid, pids) {
  if (pids.has(pid)) return;
  try {
    await readFile(`/proc/${String(pid)}/stat`, "utf8");
  } catch {
    return;
  }
  pids.add(pid);
  try {
    const tasks = await readdir(`/proc/${String(pid)}/task`);
    for (const task of tasks) {
      const children = await readFile(`/proc/${String(pid)}/task/${task}/children`, "utf8");
      for (const child of children.trim().split(/\s+/u).filter(Boolean)) await collectProcessTree(Number(child), pids);
    }
  } catch {
    // The process can exit while it is being sampled. Keep the partial sample.
  }
}

async function readProcessMetrics(pid) {
  let rssBytes = 0;
  let cpuJiffies = 0;
  try {
    const status = await readFile(`/proc/${String(pid)}/status`, "utf8");
    const rssLine = status.split(/\r?\n/u).find((line) => line.startsWith("VmRSS:"));
    if (rssLine !== undefined) rssBytes = Number(rssLine.replace(/\D+/gu, "")) * 1024;
  } catch {
    // Process exited while sampled.
  }
  try {
    const stat = await readFile(`/proc/${String(pid)}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/u);
    cpuJiffies = Number(fields[11] ?? 0) + Number(fields[12] ?? 0);
  } catch {
    // Process exited while sampled.
  }
  return { rssBytes, cpuJiffies };
}

function cpuPercent(before, after, elapsedMs) {
  const deltaJiffies = Math.max(0, after.cpuJiffies - before.cpuJiffies);
  const seconds = elapsedMs / 1_000;
  if (seconds <= 0) return 0;
  return Number(((deltaJiffies / 100 / seconds) * 100).toFixed(2));
}

async function startWorkloadMonitor(units) {
  const cgroups = [];
  for (const unit of units) {
    const cgroup = await userUnitCgroup(unit).catch(() => undefined);
    if (cgroup !== undefined) cgroups.push({ unit, cgroup, memoryCurrentPath: `/sys/fs/cgroup${cgroup}/memory.current`, memoryPeakPath: `/sys/fs/cgroup${cgroup}/memory.peak` });
  }
  const samples = [];
  const sample = async () => {
    const unitSamples = [];
    for (const entry of cgroups) {
      const current = await readNumberFile(entry.memoryCurrentPath).catch(() => undefined);
      const peak = await readNumberFile(entry.memoryPeakPath).catch(() => undefined);
      unitSamples.push({ unit: entry.unit, currentBytes: current, cgroupPeakBytes: peak });
    }
    samples.push({ sampledAtMs: performance.now(), units: unitSamples });
  };
  await sample();
  const timer = setInterval(() => { void sample(); }, 500);
  return {
    async stop() {
      clearInterval(timer);
      await sample();
      const currentTotals = samples.map((entry) => entry.units.reduce((sum, unit) => sum + (unit.currentBytes ?? 0), 0));
      const cgroupPeaks = samples.map((entry) => entry.units.reduce((sum, unit) => sum + (unit.cgroupPeakBytes ?? 0), 0));
      const peakCurrentBytes = Math.max(0, ...currentTotals);
      return {
        measurementAvailable: cgroups.length > 0,
        units: cgroups.map((entry) => entry.unit),
        sampleCount: samples.length,
        peakCurrentBytes,
        lifetimeCgroupPeakBytes: Math.max(0, ...cgroupPeaks),
        selectedPeakBytes: peakCurrentBytes,
        source: cgroups.length > 0
          ? "systemd user service cgroup memory.current sampled during benchmark; memory.peak is reported only as lifetime context"
          : "unavailable",
      };
    },
  };
}

async function userUnitCgroup(unit) {
  const completed = await run("systemctl", ["--user", "show", unit, "-p", "ControlGroup", "--value"], { timeoutMs: 10_000 });
  const value = completed.stdout.trim().split(/\r?\n/u).find((line) => line.startsWith("/"));
  if (value === undefined || value === "") throw new Error(`no cgroup for ${unit}`);
  return value;
}

async function readNumberFile(path) {
  const value = Number((await readFile(path, "utf8")).trim());
  if (!Number.isFinite(value)) throw new Error(`invalid number in ${path}`);
  return value;
}

function persistentWarmthDecision(data) {
  const speechPeakBytes = Math.max(
    data.smartTurn.repeatedThreeSecondTurns?.rssBytes?.maxSampledPeak ?? 0,
    data.whisper.repeatedThreeSecondTurns?.rssBytes?.maxSampledPeak ?? 0,
    data.contention.whisperActivePlusQueued?.rssBytes?.maxSampledPeak ?? 0,
    data.cancellation.forcedWhisperTermination?.overlapPeakRssBytes ?? 0,
  );
  const agentPeakBytes = data.activeAgentWorkload?.selectedPeakBytes ?? 0;
  const thresholdBytes = Math.floor(data.host.totalMemoryBytes * 0.75);
  const measurementAvailable = data.activeAgentWorkload?.measurementAvailable === true;
  return {
    measurementAvailable,
    hostTotalMemoryBytes: data.host.totalMemoryBytes,
    thresholdBytes,
    speechPeakBytes,
    activeAgentWorkloadPeakBytes: agentPeakBytes,
    combinedPeakBytes: speechPeakBytes + agentPeakBytes,
    accepted: measurementAvailable && speechPeakBytes + agentPeakBytes <= thresholdBytes,
    provisional: !measurementAvailable,
  };
}

async function observeQueuedWhisperAbort(port, activeSamples, queuedSamples) {
  const active = whisperRequest(port, activeSamples, "whisper-queue-active");
  await delay(50);
  const controller = new AbortController();
  const started = performance.now();
  const queued = whisperRequest(port, queuedSamples, "whisper-queue-abort", controller.signal);
  controller.abort();
  let queuedOutcome;
  try {
    await queued;
    queuedOutcome = { abortedAtClient: false, elapsedMs: elapsedSince(started), observation: "queued client request completed before abort settled" };
  } catch (error) {
    queuedOutcome = { abortedAtClient: error instanceof Error && error.name === "AbortError", elapsedMs: elapsedSince(started), observation: "queued direct HTTP client request was aborted" };
  }
  const activeStarted = performance.now();
  await active;
  return { ...queuedOutcome, activeSettledAfterMs: elapsedSince(activeStarted), adapterProofDeferred: "Future one-active/one-queued adapter cancellation still needs U2 service tests." };
}

async function observeWhisperAbort(port, samples, followupSamples) {
  const controller = new AbortController();
  const started = performance.now();
  const request = whisperRequest(port, samples, "whisper-abort", controller.signal);
  setTimeout(() => controller.abort(), 50);
  try {
    await request;
    return { abortedAtClient: false, elapsedMs: elapsedSince(started), observation: "request completed before the abort fired" };
  } catch (error) {
    const abortedAtClient = error instanceof Error && error.name === "AbortError";
    const followupStarted = performance.now();
    try {
      await withTimeout(whisperRequest(port, followupSamples, "whisper-abort-followup"), 30_000, "follow-up timed out after client abort");
      return { abortedAtClient, elapsedMs: elapsedSince(started), followupElapsedMs: elapsedSince(followupStarted), observation: "follow-up request completed after client abort" };
    } catch (followupError) {
      return { abortedAtClient, elapsedMs: elapsedSince(started), followupFailure: sanitizeError(followupError) };
    }
  }
}

async function observeForcedWhisperTermination(command, port, samples, restartSamples) {
  const runtime = spawnRuntime(command, [String(port)]);
  const start = performance.now();
  await waitForTcp("127.0.0.1", port, WARMUP_TIMEOUT_MS);
  const readyMs = elapsedSince(start);
  const request = whisperRequest(port, samples, "whisper-forced-termination").catch((error) => ({ failure: sanitizeError(error) }));
  await delay(100);
  const terminationStarted = performance.now();
  runtime.child.kill("SIGKILL");
  await Promise.race([new Promise((resolve) => runtime.child.once("close", resolve)), delay(10_000)]);
  const requestOutcome = await request;
  const replacement = await restartWhisper(command, port + 1, restartSamples);
  const overlapPeak = await processTreeSnapshot([process.pid, replacement.runtime.child.pid]);
  const replacementRuntime = replacement.runtime;
  replacement.runtime = "restarted-after-forced-termination";
  await stopRuntime(replacementRuntime);
  return {
    initialReadyMs: readyMs,
    terminationElapsedMs: elapsedSince(terminationStarted),
    requestOutcome,
    restart: replacement,
    replacementOverlapObserved: false,
    overlapPeakRssBytes: overlapPeak.rssBytes,
    observation: "The direct runtime was killed before replacement start, so no old/new Whisper process overlap was allowed in this probe.",
  };
}

async function restartSmartTurn(command) {
  const runtime = spawnRuntime(command, []);
  const lines = new LineReader(runtime.child.stdout);
  const started = performance.now();
  const ready = await lines.nextJson(WARMUP_TIMEOUT_MS);
  assertReadyRecord(ready);
  const measurement = await finishProcessMeasurement(started, [process.pid, runtime.child.pid]);
  return { elapsedMs: measurement.elapsedMs, rssBytes: measurement.rssBytes, runtime };
}

async function restartWhisper(command, port, samples) {
  const runtime = spawnRuntime(command, [String(port)]);
  const started = performance.now();
  await waitForTcp("127.0.0.1", port, WARMUP_TIMEOUT_MS);
  const tcpReadyMs = elapsedSince(started);
  const firstInference = await measureProcessOperation([process.pid, runtime.child.pid], async () => whisperRequest(port, samples, "whisper-restart-ready"));
  return { tcpReadyMs, readyAfterRepresentativeInferenceMs: tcpReadyMs + firstInference.elapsedMs, firstInference, runtime };
}

async function waitForTcp(host, port, timeoutMs) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (await canConnect(host, port)) return;
    await delay(100);
  }
  throw new Error(`timed out waiting for ${host}:${String(port)}`);
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function run(command, commandArgs, options) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out`));
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${String(code)}: ${stderr.slice(0, 500)}`));
    });
  });
}

async function stopRuntime(runtime) {
  if (runtime === undefined) return;
  if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) return;
  runtime.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => runtime.child.once("close", resolve)),
    delay(2_000).then(() => {
      if (runtime.child.exitCode === null && runtime.child.signalCode === null) runtime.child.kill("SIGKILL");
    }),
  ]);
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function elapsedSince(started) {
  return Number((performance.now() - started).toFixed(2));
}

function sanitizeError(error) {
  if (error instanceof Error) return { name: error.name, message: error.message.slice(0, 240) };
  return { name: "Error", message: String(error).slice(0, 240) };
}
