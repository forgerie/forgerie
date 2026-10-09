import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { SPEECH_POLICY } from "../../shared/speechPolicy.js";
import { validateSpeechPcm, type ValidatedSpeechPcm } from "./speechAudio.js";
import { DEFAULT_MAX_TRANSCRIPT_CHARS } from "./speechProcess.js";
import { WhisperProcess } from "./whisperProcess.js";

const execFileAsync = promisify(execFile);
const helpers: string[] = [];

async function helperScript(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "forgerie-whisper-test-"));
  helpers.push(dir);
  const path = join(dir, "worker.mjs");
  await writeFile(path, source, { mode: 0o700 });
  return path;
}

afterEach(async () => {
  await Promise.all(helpers.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function pcm(seconds = 1) {
  return pcmSamples(seconds * 16_000);
}

function pcmSamples(samples: number) {
  return validateSpeechPcm(new Uint8Array(samples * 4));
}

function belowMinimumPcm(): ValidatedSpeechPcm {
  const samples = SPEECH_POLICY.audio.minRequestSamples - 1;
  return {
    bytes: new Uint8Array(samples * SPEECH_POLICY.audio.bytesPerSample),
    samples: new Float32Array(samples),
    sampleRateHz: SPEECH_POLICY.audio.sampleRateHz,
    durationSeconds: samples / SPEECH_POLICY.audio.sampleRateHz,
  };
}

const readyRecord = `JSON.stringify({ status: 'ready', protocol: 'forgerie-whisper-worker-v1' })`;

function framedWorkerScript(handlerSource: string, readySource = `console.log(${readyRecord});`): string {
  return `
    ${readySource}
    let buffer = Buffer.alloc(0);
    let count = 0;
    process.stdin.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      void drain();
    });
    async function drain() {
      for (;;) {
        const newline = buffer.indexOf(0x0a);
        if (newline === -1) return;
        const header = JSON.parse(buffer.subarray(0, newline).toString('utf8'));
        const end = newline + 1 + header.wavBytes;
        if (buffer.byteLength < end) return;
        const wav = buffer.subarray(newline + 1, end);
        buffer = buffer.subarray(end);
        count += 1;
        ${handlerSource}
      }
    }
  `;
}

describe("WhisperProcess", () => {
  it("spawns a persistent framed-binary worker and sends exact WAV bytes", async () => {
    const script = await helperScript(framedWorkerScript(`
      console.log(JSON.stringify({ requestId: header.requestId, status: 'ready', text: wav.subarray(0, 4).toString('ascii') === 'RIFF' ? '  spoken words  ' : '' }));
    `));
    const whisper = new WhisperProcess({ commandPath: process.execPath, args: [script], sandbox: { enabled: false }, startupTimeoutMs: 1_000, operationTimeoutMs: 1_000 });
    await whisper.start();

    await expect(whisper.transcribe(pcmSamples(SPEECH_POLICY.audio.minRequestSamples))).resolves.toEqual({ text: "spoken words" });
    expect(whisper.status()).toBe("ready");
    expect(whisper.diagnostics().spawn).toMatchObject({ shell: false, envKeys: [] });
    await whisper.close();
  });

  it("counts transcript limits by Unicode code point", async () => {
    const script = await helperScript(framedWorkerScript(`
      console.log(JSON.stringify({ requestId: header.requestId, status: 'ready', text: '😀😀' }));
    `));
    const whisper = new WhisperProcess({
      commandPath: process.execPath,
      args: [script],
      sandbox: { enabled: false },
      startupTimeoutMs: 1_000,
      operationTimeoutMs: 1_000,
      maxTranscriptChars: 2,
    });
    await whisper.start();

    await expect(whisper.transcribe(pcm())).resolves.toEqual({ text: "😀😀" });
    await whisper.close();
  });

  it("starts single-flight when warmup and transcription race", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-whisper-single-flight-test-"));
    helpers.push(dir);
    const launches = join(dir, "launches");
    const script = await helperScript(`
      import { appendFile } from 'node:fs/promises';
      await appendFile(process.argv[2], '1');
      ${framedWorkerScript(`console.log(JSON.stringify({ requestId: header.requestId, status: 'ready', text: 'ready text' }));`, `setTimeout(() => console.log(${readyRecord}), 80);`)}
    `);
    const whisper = new WhisperProcess({ commandPath: process.execPath, args: [script, launches], sandbox: { enabled: false }, startupTimeoutMs: 1_000, operationTimeoutMs: 1_000 });

    const warm = whisper.start();
    await expect(whisper.transcribe(pcm())).resolves.toEqual({ text: "ready text" });
    await warm;
    expect(await readFile(launches, "utf8")).toBe("1");
    await whisper.close();
  });

  it("rejects below-minimum transcription PCM before spawn", async () => {
    const whisper = new WhisperProcess({ commandPath: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], sandbox: { enabled: false }, startupTimeoutMs: 500, operationTimeoutMs: 500 });

    await expect(whisper.transcribe(belowMinimumPcm())).rejects.toMatchObject({ kind: "too_short" });
    expect(whisper.status()).toBe("unavailable");
    await whisper.close();
  });

  it("packages Whisper behind a private-network worker wrapper", async () => {
    const wrapper = await readFile("nix/whisper-stt.nix", "utf8");

    expect(wrapper).toContain("name = \"forgerie-whisper-stt-worker\"");
    expect(wrapper).toContain("--unshare-net");
    expect(wrapper).toContain("WHISPER_SERVER");
    expect(wrapper).toContain("WHISPER_MAX_WAV_BYTES 19200044");
    expect(wrapper).toContain(`WHISPER_MAX_TRANSCRIPT_CHARS ${String(DEFAULT_MAX_TRANSCRIPT_CHARS)}`);
    expect(wrapper).toContain("WHISPER_REQUEST_TIMEOUT_MS 120000");
    expect(wrapper).toContain("speech/whisper_worker.py");
    expect(wrapper).not.toContain("''${1");
  });

  it("randomizes multipart boundaries and rejects boolean WAV byte counts in the Python worker", async () => {
    const worker = await readFile("speech/whisper_worker.py", "utf8");

    expect(worker).toContain("type(wav_bytes) is not int");
    expect(worker).toContain("DEFAULT_MAX_TRANSCRIPT_CHARS = 12_000");
    expect(worker).toContain("json.dumps(record, separators=(\",\", \":\"), ensure_ascii=False)");
    expect(worker).toContain("secrets.token_hex(16)");
    expect(worker).toContain('boundary = f"forgerie-speech-boundary-{secrets.token_hex(16)}"');
  });

  it("requires strict worker readiness", async () => {
    const nonJson = await helperScript(`
      console.log('not-json');
      setInterval(() => {}, 1000);
    `);
    const whisper = new WhisperProcess({ commandPath: process.execPath, args: [nonJson], sandbox: { enabled: false }, startupTimeoutMs: 1_000, operationTimeoutMs: 1_000 });

    await expect(whisper.start()).rejects.toMatchObject({ kind: "protocol" });
    expect(whisper.status()).toBe("unavailable");
    await whisper.close();
  });

  it("fails startup on stalled readiness and tears the child down", async () => {
    const stalled = await helperScript(`setInterval(() => {}, 1000);`);
    const whisper = new WhisperProcess({ commandPath: process.execPath, args: [stalled], sandbox: { enabled: false }, startupTimeoutMs: 80, operationTimeoutMs: 500 });
    const startedAt = Date.now();

    await expect(whisper.start()).rejects.toMatchObject({ kind: "startup_timeout" });

    expect(Date.now() - startedAt).toBeLessThan(1_200);
    expect(whisper.status()).toBe("unavailable");
    await whisper.close();
  });

  it("terminates a timed-out child and restarts before admitting later work", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-whisper-restart-test-"));
    helpers.push(dir);
    const marker = join(dir, "timed-out-once");
    const script = await helperScript(`
      import { access, writeFile } from 'node:fs/promises';
      ${framedWorkerScript(`
        let shouldDelay = false;
        try { await access(process.argv[2]); } catch { shouldDelay = true; await writeFile(process.argv[2], 'seen'); }
        setTimeout(() => {
          console.log(JSON.stringify({ requestId: header.requestId, status: 'ready', text: 'restarted text' }));
        }, shouldDelay ? 200 : 0);
      `)}
    `);
    const whisper = new WhisperProcess({
      commandPath: process.execPath,
      args: [script, marker],
      sandbox: { enabled: false },
      startupTimeoutMs: 1_000,
      operationTimeoutMs: 50,
      policy: { ...SPEECH_POLICY, restart: { ...SPEECH_POLICY.restart, restartBackoffMs: 1 } },
    });
    await whisper.start();

    await expect(whisper.transcribe(pcm())).rejects.toMatchObject({ kind: "timeout" });
    expect(whisper.status()).toBe("unavailable");
    await expect(whisper.transcribe(pcm())).resolves.toEqual({ text: "restarted text" });
    await whisper.close();
  });

  it("does not spawn a replacement after close during restart backoff", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-whisper-backoff-close-test-"));
    helpers.push(dir);
    const launches = join(dir, "launches");
    const script = await helperScript(`
      import { appendFile } from 'node:fs/promises';
      await appendFile(process.argv[2], '1');
      console.log('not-json');
      setInterval(() => {}, 1000);
    `);
    const whisper = new WhisperProcess({
      commandPath: process.execPath,
      args: [script, launches],
      sandbox: { enabled: false },
      startupTimeoutMs: 500,
      operationTimeoutMs: 500,
      policy: { ...SPEECH_POLICY, restart: { maxRestartsPerWindow: 10, restartWindowMs: 60_000, restartBackoffMs: 250 } },
    });

    await expect(whisper.start()).rejects.toMatchObject({ kind: "protocol" });
    await expect(whisper.start()).rejects.toMatchObject({ kind: "protocol" });
    const restarting = whisper.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await whisper.close();

    await expect(restarting).rejects.toMatchObject({ kind: "closed" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await readFile(launches, "utf8")).toBe("11");
  });

  it("marks ready children unavailable after exit", async () => {
    const script = await helperScript(framedWorkerScript(`
      console.log(JSON.stringify({ requestId: header.requestId, status: 'ready', text: 'ok' }));
    `, `console.log(${readyRecord}); setTimeout(() => process.exit(22), 150);`));
    const whisper = new WhisperProcess({ commandPath: process.execPath, args: [script], sandbox: { enabled: false }, startupTimeoutMs: 1_000, operationTimeoutMs: 1_000 });
    await whisper.start();
    await new Promise((resolve) => setTimeout(resolve, 220));

    expect(whisper.status()).toBe("unavailable");
    await whisper.close();
  });

  it("poisons worker errors and restarts before admitting later work", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-whisper-poison-test-"));
    helpers.push(dir);
    const marker = join(dir, "failed-once");
    const launches = join(dir, "launches");
    const script = await helperScript(`
      import { access, appendFile, writeFile } from 'node:fs/promises';
      await appendFile(process.argv[3], '1');
      ${framedWorkerScript(`
        let shouldFail = false;
        try { await access(process.argv[2]); } catch { shouldFail = true; await writeFile(process.argv[2], 'seen'); }
        if (shouldFail) {
          console.log(JSON.stringify({ requestId: header.requestId, status: 'error', error: 'CANARY_TRANSCRIPT_SHOULD_NOT_ESCAPE' }));
        } else {
          console.log(JSON.stringify({ requestId: header.requestId, status: 'ready', text: 'after restart' }));
        }
      `)}
    `);
    const whisper = new WhisperProcess({
      commandPath: process.execPath,
      args: [script, marker, launches],
      sandbox: { enabled: false },
      startupTimeoutMs: 1_000,
      operationTimeoutMs: 1_000,
      policy: { ...SPEECH_POLICY, restart: { ...SPEECH_POLICY.restart, restartBackoffMs: 1 } },
    });
    await whisper.start();

    const error = await whisper.transcribe(pcm()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: "inference_failed" });
    expect(errorMessage(error)).not.toContain("CANARY");
    expect(whisper.status()).toBe("unavailable");
    await expect(whisper.transcribe(pcm())).resolves.toEqual({ text: "after restart" });
    expect(await readFile(launches, "utf8")).toBe("11");
    await whisper.close();
  });

  it.each([
    ["non-object", "console.log(JSON.stringify('bad'));"],
    ["mismatched request ID", "console.log(JSON.stringify({ requestId: 'wrong', status: 'ready', text: 'ok' }));"],
    ["oversized transcript", "console.log(JSON.stringify({ requestId: header.requestId, status: 'ready', text: 'x'.repeat(64) }));"],
    ["oversized response", "console.log('x'.repeat(256));"],
  ])("rejects %s Whisper worker output", async (_label, responseSource) => {
    const script = await helperScript(framedWorkerScript(responseSource));
    const whisper = new WhisperProcess({ commandPath: process.execPath, args: [script], sandbox: { enabled: false }, startupTimeoutMs: 1_000, operationTimeoutMs: 1_000, maxTranscriptChars: 8, maxResponseBytes: 128 });
    await whisper.start();

    await expect(whisper.transcribe(pcm())).rejects.toMatchObject({ kind: "protocol" });
    await whisper.close();
  });

  it.runIf(process.env["FORGERIE_REAL_NIX_SMOKE"] === "1")("transcribes through the real packaged Nix worker", async () => {
    const { stdout } = await execFileAsync("nix", ["build", `path:${process.cwd()}#forgerie-whisper-stt-worker`, "--print-out-paths"], { timeout: 180_000 });
    const outPath = stdout.trim().split("\n").at(-1);
    if (outPath === undefined || outPath === "") throw new Error("nix build did not print an output path.");
    const whisper = new WhisperProcess({ commandPath: `${outPath}/bin/forgerie-whisper-stt-worker`, startupTimeoutMs: 120_000, operationTimeoutMs: 120_000 });

    await whisper.start();
    await expect(whisper.transcribe(pcmSamples(SPEECH_POLICY.audio.minRequestSamples))).rejects.toMatchObject({ kind: "empty" });
    await whisper.close();
  }, 180_000);
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
