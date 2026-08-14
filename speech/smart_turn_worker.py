#!/usr/bin/env python3
"""Persistent Forgerie Smart Turn v3.2 inference worker.

The worker exposes a bounded framed-binary stdin/stdout protocol to Node:

- ready: one JSON line, {"status":"ready","protocol":PROTOCOL}
- request: one JSON header line with pcmBytes, followed by exactly that many
  float32 little-endian mono PCM bytes at 16 kHz
- response: one correlated JSON line with either status "ready" and the turn
  decision, or status "error"

The Nix wrapper sets SMART_TURN_MODEL to the pinned ONNX model in the Nix store,
so runtime inference is local and offline after realization.
"""

import json
import os
import sys
from typing import BinaryIO

import numpy as np
import onnxruntime as ort
from transformers import WhisperFeatureExtractor

PROTOCOL = "forgerie-smart-turn-worker-v2"
SAMPLE_RATE = 16_000
WINDOW_SECONDS = 8
WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_SECONDS
MAX_HEADER_BYTES = 4096
DEFAULT_MAX_PCM_BYTES = SAMPLE_RATE * 60 * 4


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def build_session(model_path: str) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.inter_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(
        model_path,
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )


def prepare(audio: np.ndarray) -> np.ndarray:
    audio = audio[-WINDOW_SAMPLES:]
    if len(audio) < WINDOW_SAMPLES:
        audio = np.pad(audio, (WINDOW_SAMPLES - len(audio), 0))
    return audio.astype(np.float32, copy=False)


def predict(
    session: ort.InferenceSession,
    feature_extractor: WhisperFeatureExtractor,
    audio: np.ndarray,
) -> tuple[bool, float]:
    inputs = feature_extractor(
        prepare(audio),
        sampling_rate=SAMPLE_RATE,
        return_tensors="np",
        padding="max_length",
        max_length=WINDOW_SAMPLES,
        truncation=True,
        do_normalize=True,
    )
    features = np.expand_dims(
        inputs.input_features.squeeze(0).astype(np.float32), axis=0
    )
    probability = float(session.run(None, {"input_features": features})[0][0].item())
    return probability > 0.5, probability


def read_header(stream: BinaryIO) -> dict[str, object] | None:
    line = stream.readline(MAX_HEADER_BYTES + 1)
    if line == b"":
        return None
    if len(line) > MAX_HEADER_BYTES or not line.endswith(b"\n"):
        raise ValueError("request header exceeded the byte limit")
    parsed = json.loads(line.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("request header was not a JSON object")
    return parsed


def read_exact(stream: BinaryIO, length: int) -> bytes:
    chunks: list[bytes] = []
    remaining = length
    while remaining > 0:
        chunk = stream.read(remaining)
        if chunk == b"":
            raise EOFError("stdin closed before request body completed")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def response(record: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(record, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def decode_audio(raw: bytes) -> np.ndarray:
    if len(raw) % 4 != 0:
        raise ValueError("audio byte length must align to float32 samples")
    return np.frombuffer(raw, dtype="<f4")


def handle_request(
    session: ort.InferenceSession,
    feature_extractor: WhisperFeatureExtractor,
    header: dict[str, object],
    raw: bytes,
) -> dict[str, object]:
    request_id = header.get("requestId")
    try:
        if header.get("protocol") != PROTOCOL:
            raise ValueError("unsupported protocol")
        if header.get("kind") != "check_turn":
            raise ValueError("unsupported request kind")
        audio = decode_audio(raw)
        complete, probability = predict(session, feature_extractor, audio)
        return {
            "requestId": request_id,
            "status": "ready",
            "complete": complete,
            "probability": round(probability, 6),
            "samples": len(audio),
        }
    except Exception as error:
        return {
            "requestId": request_id,
            "status": "error",
            "error": str(error),
        }


def main() -> None:
    max_pcm_bytes = env_int("SMART_TURN_MAX_PCM_BYTES", DEFAULT_MAX_PCM_BYTES)
    model_path = os.environ["SMART_TURN_MODEL"]
    session = build_session(model_path)
    feature_extractor = WhisperFeatureExtractor(chunk_length=WINDOW_SECONDS)
    response({"status": "ready", "protocol": PROTOCOL})

    stream = sys.stdin.buffer
    while True:
        header = read_header(stream)
        if header is None:
            return
        request_id = header.get("requestId")
        pcm_bytes = header.get("pcmBytes")
        if type(pcm_bytes) is not int or pcm_bytes < 0 or pcm_bytes > max_pcm_bytes:
            response({"requestId": request_id, "status": "error", "error": "invalid pcmBytes"})
            return
        raw = read_exact(stream, pcm_bytes)
        response(handle_request(session, feature_extractor, header, raw))


if __name__ == "__main__":
    main()
