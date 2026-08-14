import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SPEECH_POLICY } from "../../shared/speechPolicy.js";
import { validateSpeechPcm, type ValidatedSpeechPcm } from "./speechAudio.js";
import { createSpeechService } from "./speechService.js";
import { SmartTurnProcess, buildSandboxedSpeechCommand } from "./smartTurnProcess.js";

const execFileAsync = promisify(execFile);
const helpers: string[] = [];

async function helperScript(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "forgerie-smart-turn-test-"));
  helpers.push(dir);
  const path = join(dir, "worker.mjs");
  await writeFile(path, source, { mode: 0o700 });
  return path;
}

afterEach(async () => {
  await Promise.all(helpers.splice(0).map(async (dir) => {
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true, force: true });
  }));
});

function pcm(samples = 16_000) {
  return validateSpeechPcm(new Uint8Array(samples * 4), { operation: "endpoint" });
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

const readyRecord = `JSON.stringify({ status: 'ready', protocol: 'forgerie-smart-turn-worker-v2' })`;
const framedReader = `
  function readSmartFrames(onRequest) {
    let buffer = Buffer.alloc(0);
    process.stdin.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      drain();
    });
    function drain() {
      for (;;) {
        const newline = buffer.indexOf(10);
        if (newline === -1) return;
        const request = JSON.parse(buffer.subarray(0, newline).toString('utf8'));
        const pcmBytes = request.pcmBytes;
        if (!Number.isInteger(pcmBytes) || pcmBytes < 0) throw new Error('invalid pcmBytes');
        if (buffer.length < newline + 1 + pcmBytes) return;
        const body = buffer.subarray(newline + 1, newline + 1 + pcmBytes);
        buffer = buffer.subarray(newline + 1 + pcmBytes);
        onRequest(request, body);
      }
    }
  }
`;

describe("SmartTurnProcess", () => {
  it("spawns a real correlated framed-binary worker with minimal environment", async () => {
    const script = await helperScript(`
      console.log(${readyRecord});
      ${framedReader}
      readSmartFrames((request, body) => {
        console.log(JSON.stringify({
          requestId: request.requestId,
          status: 'ready',
          complete: true,
          probability: 0.875,
          samples: body.byteLength / 4,
          envHasHome: Object.hasOwn(process.env, 'HOME'),
          envHasPiData: Object.hasOwn(process.env, 'PI_WEB_DATA_DIR')
        }));
      });
    `);
    const processClient = new SmartTurnProcess({ commandPath: process.execPath, args: [script], sandbox: { enabled: false }, startupTimeoutMs: 1_000, operationTimeoutMs: 1_000 });
    await processClient.start();

    const decision = await processClient.checkTurn(pcm(SPEECH_POLICY.audio.minRequestSamples));

    expect(decision).toMatchObject({ complete: true, probability: 0.875, samples: SPEECH_POLICY.audio.minRequestSamples });
    expect(processClient.diagnostics().spawn).toMatchObject({ shell: false, envKeys: [] });
    await processClient.close();
  });

  it("times out a ready child that stops reading a pipe-sized request and releases the service slot", async () => {
    const script = await helperScript(`
      console.log(${readyRecord});
      process.stdin.pause();
      setInterval(() => {}, 1000);
    `);
    const policy = { ...SPEECH_POLICY, timing: { ...SPEECH_POLICY.timing, operationDeadlineMs: 80, endpointDeadlineMs: 80 } };
    const processClient = new SmartTurnProcess({ commandPath: process.execPath, args: [script], sandbox: { enabled: false }, startupTimeoutMs: 500, operationTimeoutMs: 80, policy });
    const service = createSpeechService({
      policy,
      smartTurn: processClient,
      whisper: {
        status: () => "unavailable",
        start: () => Promise.resolve(),
        close: () => Promise.resolve(),
      },
    });
    await processClient.start();

    await expect(service.checkTurn(new Uint8Array(SPEECH_POLICY.audio.endpointWindowBytes))).rejects.toMatchObject({ kind: "timeout" });

    await expect.poll(() => processClient.status()).toBe("unavailable");
    await expect(service.checkTurn(new Uint8Array(SPEECH_POLICY.audio.minRequestBytes))).rejects.toMatchObject({ kind: "unavailable" });
    await service.close();
  });

  it("starts single-flight when warmup and work race", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-smart-turn-single-flight-test-"));
    helpers.push(dir);
    const launches = join(dir, "launches");
    const script = await helperScript(`
      import { appendFile } from 'node:fs/promises';
      await appendFile(process.argv[2], '1');
      setTimeout(() => console.log(${readyRecord}), 80);
      ${framedReader}
      readSmartFrames((request) => {
        console.log(JSON.stringify({ requestId: request.requestId, status: 'ready', complete: true, probability: 1, samples: 1 }));
      });
    `);
    const processClient = new SmartTurnProcess({ commandPath: process.execPath, args: [script, launches], sandbox: { enabled: false }, startupTimeoutMs: 1_000, operationTimeoutMs: 1_000 });

    const warm = processClient.start();
    await expect(processClient.checkTurn(pcm())).resolves.toMatchObject({ complete: true });
    await warm;

    expect(await readFile(launches, "utf8")).toBe("1");
    await processClient.close();
  });

  it("marks ready children unavailable after exit and restarts with bounded backoff", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-smart-turn-exit-test-"));
    helpers.push(dir);
    const marker = join(dir, "started");
    const script = await helperScript(`
      import { access, writeFile } from 'node:fs/promises';
      let first = false;
      try { await access(process.argv[2]); } catch { first = true; await writeFile(process.argv[2], 'seen'); }
      console.log(${readyRecord});
      if (first) setTimeout(() => process.exit(17), 20);
      ${framedReader}
      readSmartFrames((request) => {
        console.log(JSON.stringify({ requestId: request.requestId, status: 'ready', complete: true, probability: 0.5, samples: 1 }));
      });
    `);
    const processClient = new SmartTurnProcess({
      commandPath: process.execPath,
      args: [script, marker],
      sandbox: { enabled: false },
      startupTimeoutMs: 1_000,
      operationTimeoutMs: 1_000,
      policy: { ...SPEECH_POLICY, restart: { ...SPEECH_POLICY.restart, restartBackoffMs: 10 } },
    });
    await processClient.start();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(processClient.status()).toBe("unavailable");
    await expect(processClient.checkTurn(pcm())).resolves.toMatchObject({ complete: true });
    expect(processClient.status()).toBe("ready");
    await processClient.close();
  });

  it("enforces restart budget after repeated child failures", async () => {
    const script = await helperScript(`
      console.log('not-json');
      setInterval(() => {}, 1000);
    `);
    const processClient = new SmartTurnProcess({
      commandPath: process.execPath,
      args: [script],
      sandbox: { enabled: false },
      startupTimeoutMs: 1_000,
      operationTimeoutMs: 100,
      policy: { ...SPEECH_POLICY, restart: { maxRestartsPerWindow: 1, restartWindowMs: 60_000, restartBackoffMs: 1 } },
    });

    await expect(processClient.start()).rejects.toMatchObject({ kind: "protocol" });
    await expect(processClient.start()).rejects.toMatchObject({ kind: "protocol" });
    await expect(processClient.start()).rejects.toMatchObject({ kind: "unavailable" });
    await processClient.close();
  });

  it("rejects below-minimum endpoint PCM before spawn", async () => {
    const processClient = new SmartTurnProcess({ commandPath: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], sandbox: { enabled: false } });

    await expect(processClient.checkTurn(belowMinimumPcm())).rejects.toMatchObject({ kind: "too_short" });
    expect(processClient.status()).toBe("unavailable");
    await processClient.close();
  });

  it("rejects worker response sample counts beyond the submitted endpoint PCM", async () => {
    const script = await helperScript(`
      console.log(${readyRecord});
      ${framedReader}
      readSmartFrames((request, body) => {
        console.log(JSON.stringify({ requestId: request.requestId, status: 'ready', complete: true, probability: 1, samples: (body.byteLength / 4) + 1 }));
      });
    `);
    const processClient = new SmartTurnProcess({ commandPath: process.execPath, args: [script], sandbox: { enabled: false }, startupTimeoutMs: 1_000, operationTimeoutMs: 1_000 });

    await expect(processClient.checkTurn(pcm(SPEECH_POLICY.audio.minRequestSamples))).rejects.toMatchObject({ kind: "protocol" });
    expect(processClient.status()).toBe("unavailable");
    await processClient.close();
  });

  it("keeps the packaged Python worker frame length guard on exact integers", async () => {
    const worker = await readFile("speech/smart_turn_worker.py", "utf8");

    expect(worker).toContain("type(pcm_bytes) is not int");
  });

  it("rejects relative executable paths and builds a bwrap-style sandbox without home or Pi data mounts", () => {
    expect(() => new SmartTurnProcess({ commandPath: "node", args: [], sandbox: { enabled: false } })).toThrow(/absolute/iu);

    const launch = buildSandboxedSpeechCommand({
      commandPath: "/nix/store/example/bin/forgerie-smart-turn-worker",
      args: [],
      sandbox: { enabled: true, sandboxPath: "/nix/store/example-bwrap/bin/bwrap", network: "none" },
    });
    expect(launch.command).toBe("/nix/store/example-bwrap/bin/bwrap");
    expect(launch.args).toEqual(expect.arrayContaining(["--unshare-pid", "--proc", "/proc", "--tmpfs", "/home", "--tmpfs", "/tmp", "--unshare-net"]));
    expect(launch.args.join(" ")).not.toContain(process.env["HOME"] ?? "/home");
    expect(launch.args.join(" ")).not.toContain(".pi");
  });

  it("packages the v2 worker with a bounded raw-PCM frame limit", async () => {
    const wrapper = await readFile("nix/smart-turn.nix", "utf8");

    expect(wrapper).toContain("name = \"forgerie-smart-turn-worker\"");
    expect(wrapper).toContain("SMART_TURN_MAX_PCM_BYTES 3840000");
    expect(wrapper).toContain("--unshare-net");
  });

  it("fails closed on malformed readiness and truncates child diagnostics", async () => {
    const script = await helperScript(`
      console.error('x'.repeat(10000));
      console.log('not-json');
      setInterval(() => {}, 1000);
    `);
    const processClient = new SmartTurnProcess({ commandPath: process.execPath, args: [script], sandbox: { enabled: false }, startupTimeoutMs: 500, operationTimeoutMs: 500, maxDiagnosticBytes: 128 });

    await expect(processClient.start()).rejects.toMatchObject({ kind: "protocol" });
    expect(processClient.diagnostics().stderr.join("").length).toBeLessThanOrEqual(128);
    await processClient.close();
  });

  it("fails closed on oversized child JSON lines", async () => {
    const script = await helperScript(`
      console.log(${readyRecord});
      console.log('x'.repeat(128));
      setInterval(() => {}, 1000);
    `);
    const processClient = new SmartTurnProcess({ commandPath: process.execPath, args: [script], sandbox: { enabled: false }, startupTimeoutMs: 500, operationTimeoutMs: 500, maxLineBytes: 32 });

    await expect(processClient.start()).rejects.toMatchObject({ kind: "protocol" });
    await processClient.close();
  });

  it("fails closed when a child floods unsolicited complete JSON lines", async () => {
    const script = await helperScript(`
      console.log(${readyRecord});
      for (let index = 0; index < 128; index += 1) {
        console.log(JSON.stringify({ requestId: 'unsolicited-' + index, status: 'ready', complete: false, probability: 0, samples: 1 }));
      }
      setInterval(() => {}, 1000);
    `);
    const processClient = new SmartTurnProcess({ commandPath: process.execPath, args: [script], sandbox: { enabled: false }, startupTimeoutMs: 500, operationTimeoutMs: 500 });

    await processClient.start();
    await expect(processClient.checkTurn(pcm())).rejects.toMatchObject({ kind: "protocol" });
    expect(processClient.status()).toBe("unavailable");
    await processClient.close();
  });

  it("does not spawn a replacement after close during restart backoff", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-smart-turn-backoff-close-test-"));
    helpers.push(dir);
    const launches = join(dir, "launches");
    const script = await helperScript(`
      import { appendFile } from 'node:fs/promises';
      await appendFile(process.argv[2], '1');
      console.log('not-json');
      setInterval(() => {}, 1000);
    `);
    const processClient = new SmartTurnProcess({
      commandPath: process.execPath,
      args: [script, launches],
      sandbox: { enabled: false },
      startupTimeoutMs: 500,
      operationTimeoutMs: 500,
      policy: { ...SPEECH_POLICY, restart: { maxRestartsPerWindow: 10, restartWindowMs: 60_000, restartBackoffMs: 250 } },
    });

    await expect(processClient.start()).rejects.toMatchObject({ kind: "protocol" });
    await expect(processClient.start()).rejects.toMatchObject({ kind: "protocol" });
    const restarting = processClient.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await processClient.close();

    await expect(restarting).rejects.toMatchObject({ kind: "closed" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await readFile(launches, "utf8")).toBe("11");
  });

  it("escalates SIGTERM-resistant children to SIGKILL and settles close", async () => {
    const script = await helperScript(`
      process.on('SIGTERM', () => {});
      console.log(${readyRecord});
      setInterval(() => {}, 1000);
    `);
    const processClient = new SmartTurnProcess({ commandPath: process.execPath, args: [script], sandbox: { enabled: false }, startupTimeoutMs: 500, operationTimeoutMs: 500 });
    await processClient.start();
    const child = readChildForTest(processClient);
    const startedAt = Date.now();

    await processClient.close();

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(child.signalCode).toBe("SIGKILL");
  });

  it.runIf(process.env["FORGERIE_REAL_NIX_SMOKE"] === "1")("checks turns through the real packaged Nix worker", async () => {
    const { stdout } = await execFileAsync("nix", ["build", `path:${process.cwd()}#forgerie-smart-turn-worker`, "--print-out-paths"], { timeout: 180_000 });
    const outPath = stdout.trim().split("\n").at(-1);
    if (outPath === undefined || outPath === "") throw new Error("nix build did not print an output path.");
    const processClient = new SmartTurnProcess({ commandPath: `${outPath}/bin/forgerie-smart-turn-worker`, startupTimeoutMs: 120_000, operationTimeoutMs: 120_000 });

    await processClient.start();
    await expect(processClient.checkTurn(pcm(SPEECH_POLICY.audio.endpointWindowSamples))).resolves.toMatchObject({ samples: SPEECH_POLICY.audio.endpointWindowSamples });
    await processClient.close();
  }, 180_000);

  it("does not accumulate child exit listeners after successful requests", async () => {
    const script = await helperScript(`
      console.log(${readyRecord});
      ${framedReader}
      readSmartFrames((request) => {
        console.log(JSON.stringify({ requestId: request.requestId, status: 'ready', complete: true, probability: 0.75, samples: 1 }));
      });
    `);
    const processClient = new SmartTurnProcess({ commandPath: process.execPath, args: [script], sandbox: { enabled: false }, startupTimeoutMs: 500, operationTimeoutMs: 500 });
    await processClient.start();
    const child = readChildForTest(processClient);
    const baseline = child.listenerCount("exit");

    for (let index = 0; index < 25; index += 1) await expect(processClient.checkTurn(pcm())).resolves.toMatchObject({ complete: true });

    expect(child.listenerCount("exit")).toBe(baseline);
    await processClient.close();
  });
});

function readChildForTest(processClient: SmartTurnProcess): { signalCode: NodeJS.Signals | null; listenerCount(event: string): number } {
  const child: unknown = Reflect.get(processClient, "child");
  if (!isChildForTest(child)) throw new Error("SmartTurnProcess child was not available for test inspection.");
  return child;
}

function isChildForTest(value: unknown): value is { signalCode: NodeJS.Signals | null; listenerCount(event: string): number } {
  return typeof value === "object" && value !== null && "listenerCount" in value && typeof value.listenerCount === "function" && "signalCode" in value;
}
