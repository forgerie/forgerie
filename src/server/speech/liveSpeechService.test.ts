import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SPEECH_POLICY } from "../../shared/speechPolicy.js";
import { createLiveSpeechService } from "./liveSpeechService.js";

const temps: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.close(() => { resolve(); }); })));
  await Promise.all(temps.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function configDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "forgerie-live-speech-"));
  temps.push(dir);
  return dir;
}

describe("live speech service composition", () => {
  it("is unavailable until the Speech to text plugin has an address", async () => {
    const dir = await configDir();
    const service = createLiveSpeechService({ env: { PI_WEB_CONFIG: join(dir, "config.json") }, cwd: dir });
    try {
      await expect(service.status()).resolves.toEqual({ smartTurn: "unavailable", whisper: "unavailable", capability: "unavailable" });
      await expect(service.transcribe(new Uint8Array(SPEECH_POLICY.audio.minRequestBytes))).rejects.toMatchObject({ kind: "unavailable" });
    } finally {
      await service.close();
    }
  });

  it("sends speech to the plugin's address with the key from FORGERIE_SPEECH_API_KEY", async () => {
    const authorizations: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      authorizations.push(request.headers.authorization);
      request.resume();
      request.on("end", () => {
        const body = request.url === "/v1/models" ? { object: "list", data: [] } : { text: "hello" };
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("The test server has no TCP port.");
    const port = address.port;
    const dir = await configDir();
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify({ plugins: { "speech-to-text": { settings: { base_url: `http://127.0.0.1:${String(port)}/v1` } } } }));

    const service = createLiveSpeechService({ env: { PI_WEB_CONFIG: path, FORGERIE_SPEECH_API_KEY: " speech-key " }, cwd: dir });
    try {
      await expect(service.status()).resolves.toMatchObject({ whisper: "ready", capability: "manual-only" });
      await expect(service.transcribe(new Uint8Array(SPEECH_POLICY.audio.minRequestBytes))).resolves.toEqual({ text: "hello" });
      expect(authorizations).toEqual(["Bearer speech-key", "Bearer speech-key"]);
    } finally {
      await service.close();
    }
  });
});
