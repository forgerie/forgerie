import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";
import { createSpeechService, speechServiceUnavailable, type SpeechBackend, type SpeechService } from "./speechService.js";
import { WhisperProcess } from "./whisperProcess.js";

export interface LiveSpeechCommandEnvironment {
  readonly PATH?: string;
  readonly FORGERIE_WHISPER_STT_WORKER?: string;
}

export interface LiveSpeechCommands {
  readonly whisper: string | undefined;
}

const whisperCommandName = "forgerie-whisper-stt-worker";

export async function createLiveSpeechService(env: LiveSpeechCommandEnvironment = process.env): Promise<SpeechService> {
  const commands = await resolveLiveSpeechCommands(env);
  const whisper = backendForCommand(commands.whisper, whisperBackend, "whisper_runtime_missing", "whisper_runtime_unusable");
  return createSpeechService({ whisper });
}

export async function resolveLiveSpeechCommands(env: LiveSpeechCommandEnvironment = process.env): Promise<LiveSpeechCommands> {
  const whisper = await resolveCommand(env.FORGERIE_WHISPER_STT_WORKER, whisperCommandName, env.PATH);
  return { whisper };
}

function whisperBackend(commandPath: string): SpeechBackend {
  return new WhisperProcess({ commandPath });
}

async function resolveCommand(override: string | undefined, commandName: string, pathValue: string | undefined): Promise<string | undefined> {
  if (override !== undefined && override !== "") {
    if (!isAbsolute(override)) return undefined;
    return await resolveExecutablePath(override);
  }
  for (const directory of (pathValue ?? "").split(delimiter)) {
    if (directory === "") continue;
    const candidate = resolve(directory, commandName);
    const resolved = await resolveExecutablePath(candidate);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

async function resolveExecutablePath(path: string): Promise<string | undefined> {
  try {
    const absolutePath = isAbsolute(path) ? path : resolve(path);
    await access(absolutePath, constants.X_OK);
    const realPath = await realpath(absolutePath);
    return isAbsolute(realPath) ? realPath : undefined;
  } catch {
    return undefined;
  }
}

function backendForCommand(commandPath: string | undefined, create: (commandPath: string) => SpeechBackend, missingReason: string, unusableReason: string): SpeechBackend {
  if (commandPath === undefined) return speechServiceUnavailable(missingReason);
  return safeBackend(() => create(commandPath), unusableReason);
}

function safeBackend(create: () => SpeechBackend, reason: string): SpeechBackend {
  try {
    return create();
  } catch {
    return speechServiceUnavailable(reason);
  }
}
