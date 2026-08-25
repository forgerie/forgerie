import { describe, expect, it } from "vitest";
import { SPEECH_POLICY } from "../../../shared/speechPolicy";
import {
  VOICE_CAPTURE_NONE,
  VOICE_HEARING_WINDOW_MS,
  voiceCaptureClock,
  voiceCaptureDisplay,
  voiceCaptureDisplayChanged,
  voiceCaptureNoted,
} from "./voiceCaptureProgress";

const RATE = SPEECH_POLICY.audio.sampleRateHz;
const NOW = 1_700_000_000_000;

/** One second of voiced audio at the shipped sample rate. */
const oneSecond = { sampleCount: RATE };

describe("voiceCaptureNoted", () => {
  it("counts time spent speaking, not time with the microphone open", () => {
    // Silence between words is not voiced audio and must not inflate the
    // number that tells a reader the microphone is working.
    const after = voiceCaptureNoted(VOICE_CAPTURE_NONE, oneSecond, RATE, NOW);
    expect(voiceCaptureDisplay(after, NOW).seconds).toBe(1);
  });

  it("accumulates across reports", () => {
    let progress = VOICE_CAPTURE_NONE;
    for (let index = 0; index < 7; index += 1) progress = voiceCaptureNoted(progress, oneSecond, RATE, NOW);
    expect(voiceCaptureClock(voiceCaptureDisplay(progress, NOW))).toBe("0:07");
  });

  it("ignores a report with no voiced audio in it", () => {
    expect(voiceCaptureNoted(VOICE_CAPTURE_NONE, { sampleCount: 0 }, RATE, NOW)).toBe(VOICE_CAPTURE_NONE);
  });

  it("ignores an impossible sample rate rather than reporting infinite speech", () => {
    expect(voiceCaptureNoted(VOICE_CAPTURE_NONE, oneSecond, 0, NOW)).toBe(VOICE_CAPTURE_NONE);
  });
});

describe("voiceCaptureDisplay", () => {
  it("is not hearing anything before the first word", () => {
    expect(voiceCaptureDisplay(VOICE_CAPTURE_NONE, NOW)).toEqual({ hearing: false, seconds: 0 });
  });

  it("hears a voice that has just arrived", () => {
    const progress = voiceCaptureNoted(VOICE_CAPTURE_NONE, oneSecond, RATE, NOW);
    expect(voiceCaptureDisplay(progress, NOW).hearing).toBe(true);
  });

  it("stops hearing once the reader has gone quiet, and keeps what was said", () => {
    const progress = voiceCaptureNoted(VOICE_CAPTURE_NONE, oneSecond, RATE, NOW);
    const later = voiceCaptureDisplay(progress, NOW + VOICE_HEARING_WINDOW_MS);
    expect(later).toEqual({ hearing: false, seconds: 1 });
  });

  it("rounds down, so a reader is never told they said more than they did", () => {
    const progress = voiceCaptureNoted(VOICE_CAPTURE_NONE, { sampleCount: RATE * 1.9 }, RATE, NOW);
    expect(voiceCaptureDisplay(progress, NOW).seconds).toBe(1);
  });
});

describe("voiceCaptureDisplayChanged", () => {
  it("reports nothing to redraw between two chunks of the same second", () => {
    // Voiced reports arrive tens of times a second. Without this the dialog
    // would re-render at audio rate to show a number that moves once a second.
    const first = voiceCaptureNoted(VOICE_CAPTURE_NONE, { sampleCount: RATE / 50 }, RATE, NOW);
    const second = voiceCaptureNoted(first, { sampleCount: RATE / 50 }, RATE, NOW + 20);
    expect(voiceCaptureDisplayChanged(
      voiceCaptureDisplay(first, NOW),
      voiceCaptureDisplay(second, NOW + 20),
    )).toBe(false);
  });

  it("reports a redraw when the voice stops", () => {
    const progress = voiceCaptureNoted(VOICE_CAPTURE_NONE, oneSecond, RATE, NOW);
    expect(voiceCaptureDisplayChanged(
      voiceCaptureDisplay(progress, NOW),
      voiceCaptureDisplay(progress, NOW + VOICE_HEARING_WINDOW_MS),
    )).toBe(true);
  });

  it("reports a redraw when the clock ticks over", () => {
    const first = voiceCaptureNoted(VOICE_CAPTURE_NONE, oneSecond, RATE, NOW);
    const second = voiceCaptureNoted(first, oneSecond, RATE, NOW);
    expect(voiceCaptureDisplayChanged(
      voiceCaptureDisplay(first, NOW),
      voiceCaptureDisplay(second, NOW),
    )).toBe(true);
  });
});

describe("voiceCaptureClock", () => {
  it("pads seconds past the first minute", () => {
    expect(voiceCaptureClock({ hearing: true, seconds: 65 })).toBe("1:05");
    expect(voiceCaptureClock({ hearing: false, seconds: 0 })).toBe("0:00");
  });
});
