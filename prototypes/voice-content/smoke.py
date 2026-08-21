#!/usr/bin/env python3
"""Run a real Kokoro to Whisper round trip for the prototype."""

from __future__ import annotations

import argparse
import io
import json
import shutil
import subprocess
import time
import wave
from pathlib import Path

from voice_runtime import TURN_WINDOW_BYTES, VoiceRuntime, VoiceRuntimeError

DEFAULT_TEXT = "Voice and content work together in this prototype."


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify the real prototype speech runtimes.")
    parser.add_argument("--text", default=DEFAULT_TEXT)
    parser.add_argument("--voice", default="af_bella")
    parser.add_argument("--keep-wav", type=Path)
    return parser.parse_args()


def to_float32_pcm(wav_bytes: bytes) -> bytes:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise VoiceRuntimeError("ffmpeg is unavailable")
    completed = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-i",
            "pipe:0",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "f32le",
            "pipe:1",
        ],
        input=wav_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=30,
    )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise VoiceRuntimeError(f"ffmpeg conversion failed: {detail}")
    if not completed.stdout:
        raise VoiceRuntimeError("ffmpeg produced empty PCM")
    return completed.stdout


def wav_descriptor(wav_bytes: bytes) -> dict[str, object]:
    with wave.open(io.BytesIO(wav_bytes), "rb") as reader:
        return {
            "channels": reader.getnchannels(),
            "sampleRate": reader.getframerate(),
            "sampleWidthBytes": reader.getsampwidth(),
            "frames": reader.getnframes(),
            "durationSeconds": round(reader.getnframes() / reader.getframerate(), 3),
        }


def main() -> int:
    args = arguments()
    with VoiceRuntime.from_environment() as runtime:
        warm_started = time.perf_counter()
        runtime.warm()
        warm_seconds = time.perf_counter() - warm_started

        tts_started = time.perf_counter()
        wav_bytes, engine = runtime.synthesize(args.text, args.voice)
        tts_seconds = time.perf_counter() - tts_started

        if args.keep_wav is not None:
            args.keep_wav.parent.mkdir(parents=True, exist_ok=True)
            args.keep_wav.write_bytes(wav_bytes)

        pcm = to_float32_pcm(wav_bytes)
        stt_started = time.perf_counter()
        transcript = runtime.transcribe_pcm(pcm)
        stt_seconds = time.perf_counter() - stt_started

        turn_started = time.perf_counter()
        turn = runtime.check_turn(pcm[-TURN_WINDOW_BYTES:])
        turn_seconds = time.perf_counter() - turn_started

        result = {
            "sourceText": args.text,
            "transcript": transcript,
            "warmSeconds": round(warm_seconds, 3),
            "ttsSeconds": round(tts_seconds, 3),
            "sttSeconds": round(stt_seconds, 3),
            "turnSeconds": round(turn_seconds, 3),
            "turnDecision": turn,
            "ttsEngine": engine,
            "ttsAudio": wav_descriptor(wav_bytes),
            "sttInput": {
                "format": "float32le",
                "sampleRate": 16000,
                "channels": 1,
                "bytes": len(pcm),
            },
        }
        print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
