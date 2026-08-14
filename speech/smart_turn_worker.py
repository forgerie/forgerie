#!/usr/bin/env python3
"""Persistent Forgerie Smart Turn v3.2 inference worker.

Reads one JSON object per line from stdin and writes one response per line to
stdout. Request audio is base64-encoded float32 little-endian mono PCM at
16 kHz. The Nix wrapper sets SMART_TURN_MODEL to the pinned ONNX model in the
Nix store, so runtime inference is local and offline after realization.
"""

import base64
import json
import os
import sys

import numpy as np
import onnxruntime as ort
from transformers import WhisperFeatureExtractor

PROTOCOL = "forgerie-smart-turn-worker-v1"
SAMPLE_RATE = 16_000
WINDOW_SECONDS = 8
WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_SECONDS


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


def decode_audio(encoded_audio: str) -> np.ndarray:
    raw = base64.b64decode(encoded_audio, validate=True)
    if len(raw) % 4 != 0:
        raise ValueError("audio byte length must align to float32 samples")
    return np.frombuffer(raw, dtype="<f4")


def handle_request(
    session: ort.InferenceSession,
    feature_extractor: WhisperFeatureExtractor,
    line: str,
) -> dict[str, object]:
    request_id = None
    try:
        request = json.loads(line)
        request_id = request.get("requestId")
        if request.get("protocol") != PROTOCOL:
            raise ValueError("unsupported protocol")
        audio = decode_audio(request["audio"])
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
    model_path = os.environ["SMART_TURN_MODEL"]
    session = build_session(model_path)
    feature_extractor = WhisperFeatureExtractor(chunk_length=WINDOW_SECONDS)
    print(json.dumps({"status": "ready", "protocol": PROTOCOL}), flush=True)

    for line in sys.stdin:
        response = handle_request(session, feature_extractor, line)
        print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
