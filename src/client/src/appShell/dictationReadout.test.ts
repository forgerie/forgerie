import { describe, expect, it } from "vitest";
import {
  DICTATION_FULL_SCALE_RMS,
  DictationLevelReservoir,
  barHeight,
  dictationReadout,
  dictationVoicedClock,
  dictationWaitClock,
} from "./dictationReadout";
import type { PromptDictationState } from "../controllers/promptDictationController";

const noAudio = { bars: [], voicedMs: 0, waitMs: 0 };

describe("dictation readout", () => {
  it("maps measured loudness to bar heights and silence to nothing", () => {
    expect(barHeight(0)).toBe(0);
    expect(barHeight(-1)).toBe(0);
    expect(barHeight(Number.NaN)).toBe(0);
    expect(barHeight(DICTATION_FULL_SCALE_RMS)).toBe(1);
    expect(barHeight(DICTATION_FULL_SCALE_RMS * 4)).toBe(1);
    // Quiet speech still draws: a bar under the floor would read as silence.
    expect(barHeight(0.0001)).toBeCloseTo(0.12, 5);
    expect(barHeight(DICTATION_FULL_SCALE_RMS / 4)).toBeCloseTo(0.5, 5);
  });

  it("keeps the whole turn in view by folding pairs once the reservoir fills", () => {
    const reservoir = new DictationLevelReservoir(4);
    for (const rms of [0.14, 0.02, 0.14, 0.02]) reservoir.push({ rms, voiced: true });
    expect(reservoir.bars()).toHaveLength(4);

    reservoir.push({ rms: 0.14, voiced: true });
    const folded = reservoir.bars();
    expect(folded.length).toBeLessThanOrEqual(4);
    // The loud batches survive the fold; the shape is kept, the resolution is not.
    expect(Math.max(...folded)).toBe(1);
    expect(folded[0]).toBe(1);
  });

  it("draws nothing for a batch the pipeline judged silent", () => {
    const reservoir = new DictationLevelReservoir(8);
    reservoir.push({ rms: 0.2, voiced: false });
    expect(reservoir.bars()).toEqual([0]);
  });

  it("clears back to an empty turn", () => {
    const reservoir = new DictationLevelReservoir(8);
    reservoir.push({ rms: 0.1, voiced: true });
    reservoir.clear();
    expect(reservoir.bars()).toEqual([]);
  });

  it("formats speech captured in whole seconds and a watched wait in tenths", () => {
    expect(dictationVoicedClock(0)).toBe("0:00");
    expect(dictationVoicedClock(7_400)).toBe("0:07");
    expect(dictationVoicedClock(63_000)).toBe("1:03");
    expect(dictationVoicedClock(-5)).toBe("0:00");
    expect(dictationWaitClock(2_449)).toBe("2.4s");
    expect(dictationWaitClock(0)).toBe("0.0s");
    expect(dictationWaitClock(-100)).toBe("0.0s");
  });

  it("reports listening without a label, because the waveform and clock already say it", () => {
    const bars = [0.4, 0.9];
    const listening: readonly PromptDictationState[] = [
      { tag: "acquiring", gesture: "pressing" },
      { tag: "acquiring", gesture: "held" },
      { tag: "pressed" },
      { tag: "auto" },
      { tag: "held" },
      { tag: "checking" },
      { tag: "manual-only", reason: "smart-turn-unavailable" },
    ];
    for (const state of listening) {
      expect(dictationReadout(state, { bars, voicedMs: 7_000, waitMs: 0 })).toEqual({ kind: "listening", bars, clock: "0:07" });
    }
  });

  it("counts the wait while the gateway holds the audio", () => {
    expect(dictationReadout({ tag: "transcribing" }, { bars: [0.5], voicedMs: 12_000, waitMs: 2_400 }))
      .toEqual({ kind: "working", words: "Transcribing", bars: [0.5], clock: "2.4s" });
  });

  it("says nothing at all when there is nothing to report", () => {
    expect(dictationReadout({ tag: "idle" }, noAudio)).toEqual({ kind: "none" });
    expect(dictationReadout({ tag: "unavailable", reason: "warming" }, noAudio)).toEqual({ kind: "none" });
    // A cancelled turn is the reader's own decision, not news.
    expect(dictationReadout({ tag: "error", reason: "cancelled", message: "cancelled", retryable: false }, noAudio)).toEqual({ kind: "none" });
  });

  it("names each failure the reader can act on", () => {
    const cases: readonly [PromptDictationState, string][] = [
      [{ tag: "error", reason: "too-short", message: "short", retryable: true }, "Too short to transcribe."],
      [{ tag: "error", reason: "initial-speech-timeout", message: "quiet", retryable: true }, "Nothing heard."],
      [{ tag: "error", reason: "permission-denied", message: "denied", retryable: false }, "No microphone permission."],
      [{ tag: "error", reason: "capture-failed", message: "gone", retryable: true }, "The microphone stopped."],
      [{ tag: "error", reason: "transcription-failed", message: "failed", retryable: false }, "Transcription failed."],
      [{ tag: "empty" }, "Nothing heard."],
      [{ tag: "retained-retry", expiresAtMs: 0, reason: "timeout" }, "Transcription failed. Press the microphone to retry."],
    ];
    for (const [state, words] of cases) {
      expect(dictationReadout(state, noAudio)).toEqual({ kind: "stated", words });
    }
  });
});
