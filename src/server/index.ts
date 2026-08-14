#!/usr/bin/env node
import { effectivePiWebConfig, maxUploadBytes } from "../config.js";
import { buildApp } from "./app.js";
import { createLiveSpeechService } from "./speech/liveSpeechService.js";
import type { SpeechService } from "./speech/speechService.js";

const { config } = effectivePiWebConfig();
const port = config.port ?? 8504;
const host = config.host ?? "127.0.0.1";
let speech: SpeechService | undefined;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;

try {
  speech = await createLiveSpeechService();
  app = await buildApp({ bodyLimit: maxUploadBytes(process.env, config), speech, speechAllowedHosts: speechAllowedHosts(process.env, host, port) });
  await app.listen({ port, host });
  void speech.warm().catch((error: unknown) => {
    app?.log.warn({ err: error }, "failed to warm speech runtime");
  });
} catch (error) {
  if (app !== undefined) await app.close();
  else if (speech !== undefined) await speech.close();
  throw error;
}

function speechAllowedHosts(env: NodeJS.ProcessEnv, host: string, port: number): string[] {
  const configured = env["FORGERIE_SPEECH_ALLOWED_HOSTS"];
  if (configured !== undefined && configured !== "") return configured.split(",").map((value) => value.trim()).filter((value) => value !== "");
  return [...new Set([withPort(host, port), withPort("localhost", port), withPort("127.0.0.1", port), withPort("[::1]", port)])];
}

function withPort(host: string, port: number): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]:${String(port)}` : `${host}:${String(port)}`;
}
