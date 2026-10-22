import type { LoadOptions } from "../../config.js";
import { createOpenAiTranscriptionBackend } from "./openAiTranscriptionBackend.js";
import { createSpeechService, type SpeechService } from "./speechService.js";
import { createSpeechToTextSettingsReader } from "./speechToTextSettings.js";

/** The speech service's key lives only in the web process's environment, never in config or the browser. */
export const SPEECH_API_KEY_ENV = "FORGERIE_SPEECH_API_KEY";

/** Voice input through the Speech to text plugin: its settings come from Forgerie's config, its key from the environment. */
export function createLiveSpeechService(options: LoadOptions = {}): SpeechService {
  const env = options.env ?? process.env;
  const settings = createSpeechToTextSettingsReader(options);
  return createSpeechService({
    backend: createOpenAiTranscriptionBackend({
      settings,
      apiKey: () => {
        const key = env[SPEECH_API_KEY_ENV]?.trim();
        return key === undefined || key === "" ? undefined : key;
      },
    }),
  });
}
