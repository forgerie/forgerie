#!/usr/bin/env python3
"""Persistent local Kokoro adapter copied from Comics for this prototype."""

import json
import os
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from kokoro import KModel, KPipeline

PROTOCOL = "kokoro-worker-v1"


VOICES = {
    "af_bella": (os.environ["KOKORO_BELLA"], os.environ["KOKORO_BELLA_DIGEST"]),
    "af_heart": (os.environ["KOKORO_HEART"], os.environ["KOKORO_HEART_DIGEST"]),
}


def descriptor(voice: str) -> dict[str, object]:
    _, digest = VOICES[voice]
    return {
        "modelRevision": os.environ["KOKORO_MODEL_REVISION"],
        "modelDigest": os.environ["KOKORO_MODEL_DIGEST"],
        "voice": voice,
        "voiceDigest": digest,
        "languageCode": "a",
        "sampleRate": 24000,
        "format": "wav-pcm16-mono",
    }


def respond(response: dict[str, object]) -> None:
    json.dump(response, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    sys.stdout.flush()


def synthesize(request: dict[str, object], pipeline: KPipeline) -> None:
    request_id = request.get("requestId", "")
    voice = request.get("voice", "")
    response: dict[str, object] = {
        "protocol": PROTOCOL,
        "requestId": request_id,
    }
    try:
        if request.get("protocol") != PROTOCOL:
            raise ValueError("unsupported worker protocol")
        if not isinstance(voice, str) or voice not in VOICES:
            raise ValueError("voice is not allowlisted")
        response["engine"] = descriptor(voice)
        text = request["text"]
        if not isinstance(text, str) or not text or len(text.encode("utf-8")) > 4096:
            raise ValueError("text is outside worker limits")
        output = Path(str(request["output"]))
        if output.suffix != ".wav" or not output.parent.is_dir():
            raise ValueError("output path is not a prepared WAV destination")
        chunks = [
            audio
            for _, _, audio in pipeline(
                text,
                voice=VOICES[voice][0],
                speed=1.0,
                split_pattern=r"\n+",
            )
        ]
        if not chunks:
            raise RuntimeError("Kokoro produced no audio")
        sf.write(output, np.concatenate(chunks), 24000, subtype="PCM_16")
        response["status"] = "ready"
    except Exception as error:
        response["status"] = "failed"
        response["error"] = str(error)
    respond(response)


def main() -> int:
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable; CPU fallback is forbidden")
    model = KModel(
        repo_id="hexgrad/Kokoro-82M",
        config=os.environ["KOKORO_CONFIG"],
        model=os.environ["KOKORO_MODEL"],
    ).to("cuda").eval()
    pipeline = KPipeline(
        lang_code="a",
        repo_id="hexgrad/Kokoro-82M",
        model=model,
        device="cuda",
    )
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("worker request must be an object")
            synthesize(request, pipeline)
        except Exception as error:
            respond({
                "protocol": PROTOCOL,
                "requestId": "",
                "status": "failed",
                "engine": descriptor("af_bella"),
                "error": str(error),
            })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
