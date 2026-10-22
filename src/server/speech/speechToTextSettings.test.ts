import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSpeechToTextSettingsReader, readSpeechToTextSettings, SPEECH_TO_TEXT_OFF } from "./speechToTextSettings.js";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Speech to text settings", () => {
  it("has no address until one is set, and speaks the OpenAI defaults", () => {
    expect(readSpeechToTextSettings({})).toEqual({ baseUrl: undefined, model: "whisper-1", language: undefined });
  });

  it("uses the address without a trailing slash, the model and a lower-case language", () => {
    const settings = readSpeechToTextSettings({ plugins: { "speech-to-text": { settings: { base_url: "https://voice.example.test/v1/", model: "large-v3", language: "EN" } } } });
    expect(settings).toEqual({ baseUrl: "https://voice.example.test/v1", model: "large-v3", language: "en" });
  });

  it("has no address when the plugin is off", () => {
    const settings = readSpeechToTextSettings({ plugins: { "speech-to-text": { enabled: false, settings: { base_url: "https://voice.example.test/v1" } } } });
    expect(settings.baseUrl).toBeUndefined();
  });

  it("reads the config at each use and turns voice input off when the config is unreadable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-speech-settings-"));
    temps.push(dir);
    const path = join(dir, "config.json");
    const read = createSpeechToTextSettingsReader({ env: { PI_WEB_CONFIG: path }, cwd: dir });

    expect(read()).toEqual(SPEECH_TO_TEXT_OFF);
    await writeFile(path, JSON.stringify({ plugins: { "speech-to-text": { settings: { base_url: "http://127.0.0.1:8792/v1" } } } }));
    expect(read().baseUrl).toBe("http://127.0.0.1:8792/v1");
    await writeFile(path, "{ not json");
    expect(read()).toEqual(SPEECH_TO_TEXT_OFF);
  });
});
