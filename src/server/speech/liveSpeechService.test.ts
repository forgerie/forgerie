import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createLiveSpeechService, resolveLiveSpeechCommands } from "./liveSpeechService.js";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("live speech service composition", () => {
  it("resolves named commands from PATH and accepts absolute executable overrides only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-live-speech-test-"));
    temps.push(dir);
    const smartTurn = join(dir, "forgerie-smart-turn-worker");
    const whisper = join(dir, "forgerie-whisper-stt-worker");
    await writeFile(smartTurn, "#!/bin/sh\nexit 0\n");
    await writeFile(whisper, "#!/bin/sh\nexit 0\n");
    await chmod(smartTurn, 0o755);
    await chmod(whisper, 0o755);

    await expect(resolveLiveSpeechCommands({ PATH: dir })).resolves.toEqual({ smartTurn: await realpath(smartTurn), whisper: await realpath(whisper) });
    await expect(resolveLiveSpeechCommands({ PATH: dir, FORGERIE_SMART_TURN_WORKER: "relative-worker", FORGERIE_WHISPER_STT_WORKER: whisper })).resolves.toEqual({ smartTurn: undefined, whisper: await realpath(whisper) });
  });

  it("resolves relative PATH entries to absolute real paths and ignores unusable candidates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-live-speech-relative-path-test-"));
    temps.push(dir);
    const smartTurn = join(dir, "forgerie-smart-turn-worker");
    const whisper = join(dir, "forgerie-whisper-stt-worker");
    await writeFile(smartTurn, "#!/bin/sh\nexit 0\n");
    await writeFile(whisper, "#!/bin/sh\nexit 0\n");
    await chmod(smartTurn, 0o755);
    await chmod(whisper, 0o755);

    await expect(resolveLiveSpeechCommands({ PATH: relative(process.cwd(), dir) })).resolves.toEqual({ smartTurn: await realpath(smartTurn), whisper: await realpath(whisper) });
    await expect(resolveLiveSpeechCommands({ PATH: "relative-path-entry-that-does-not-exist" })).resolves.toEqual({ smartTurn: undefined, whisper: undefined });
  });

  it("degrades construction to an unavailable service when runtimes are missing or unsafe", async () => {
    const service = await createLiveSpeechService({ PATH: "", FORGERIE_SMART_TURN_WORKER: "relative-worker", FORGERIE_WHISPER_STT_WORKER: "relative-worker" });
    try {
      expect(service.status()).toEqual({ smartTurn: "unavailable", whisper: "unavailable", capability: "unavailable" });
      await expect(service.checkTurn(new Uint8Array(4))).rejects.toMatchObject({ kind: "unavailable" });
      await expect(service.transcribe(new Uint8Array(4))).rejects.toMatchObject({ kind: "unavailable" });
    } finally {
      await service.close();
    }
  });
});
