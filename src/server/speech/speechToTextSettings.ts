import { loadPiWebConfig, type LoadOptions, type PiWebConfig } from "../../config.js";
import { speechToTextManifest } from "../../shared/appPluginManifests.js";
import { appPluginEnabled, resolveAppSettings } from "../../shared/appPlugins.js";

/** Where voice input goes. `baseUrl` is undefined when the plugin is off or has no address. */
export interface SpeechToTextSettings {
  readonly baseUrl: string | undefined;
  readonly model: string;
  /** An ISO-639-1 code, or undefined to let the service detect the language. */
  readonly language: string | undefined;
}

export const SPEECH_TO_TEXT_OFF: SpeechToTextSettings = { baseUrl: undefined, model: "whisper-1", language: undefined };

export function readSpeechToTextSettings(config: Pick<PiWebConfig, "plugins">): SpeechToTextSettings {
  const entry = config.plugins?.[speechToTextManifest.id];
  const values = resolveAppSettings(speechToTextManifest, entry?.settings);
  const baseUrl = String(values["base_url"]).trim();
  const language = String(values["language"]).trim().toLowerCase();
  return {
    baseUrl: appPluginEnabled(speechToTextManifest, entry) && baseUrl !== "" ? baseUrl.replace(/\/+$/u, "") : undefined,
    model: String(values["model"]).trim(),
    language: language === "auto" ? undefined : language,
  };
}

/** Read at each use, so a Settings change applies to the next recording. An unreadable config means no voice input. */
export function createSpeechToTextSettingsReader(options: LoadOptions = {}): () => SpeechToTextSettings {
  return () => {
    try { return readSpeechToTextSettings(loadPiWebConfig(options).config); }
    catch { return SPEECH_TO_TEXT_OFF; }
  };
}
