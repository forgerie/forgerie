#!/usr/bin/env python3
"""PROTOTYPE speech runtime over Forgerie STT and Comics TTS workers."""

from __future__ import annotations

import json
import math
import os
import queue
import struct
import subprocess
import tempfile
import threading
import uuid
from pathlib import Path
from typing import BinaryIO

STT_PROTOCOL = "forgerie-whisper-worker-v1"
TURN_PROTOCOL = "forgerie-smart-turn-worker-v2"
TTS_PROTOCOL = "kokoro-worker-v1"
SAMPLE_RATE = 16_000
MIN_PCM_BYTES = SAMPLE_RATE * 4 // 10
MAX_PCM_BYTES = SAMPLE_RATE * 4 * 60
TURN_WINDOW_BYTES = SAMPLE_RATE * 4 * 8
MAX_JSON_LINE_BYTES = 64 * 1024
MAX_TTS_TEXT_BYTES = 4096
TTS_VOICES = frozenset({"af_bella", "af_heart"})


class VoiceRuntimeError(RuntimeError):
    """A worker or prototype transport failed."""


class _WorkerSupervisor:
    """Spawns every worker from one long-lived thread.

    bubblewrap's --die-with-parent uses PR_SET_PDEATHSIG, which fires when the
    thread that spawned the sandbox exits, not when the process exits. Spawning
    a worker from a warmup or request thread therefore kills that worker as soon
    as the thread finishes. Measured here: the first warm-up spawned Whisper on
    a pool thread and the model reloaded on the next request. All spawns go
    through this thread instead.
    """

    def __init__(self) -> None:
        self._requests: queue.Queue[tuple[str, queue.Queue[object]]] = queue.Queue()
        self._thread = threading.Thread(target=self._run, name="voice-worker-spawner", daemon=True)
        self._thread.start()

    def spawn(self, command: str) -> subprocess.Popen[bytes]:
        outbox: queue.Queue[object] = queue.Queue(maxsize=1)
        self._requests.put((command, outbox))
        outcome = outbox.get()
        if isinstance(outcome, BaseException):
            raise VoiceRuntimeError(f"could not start {command}") from outcome
        if not isinstance(outcome, subprocess.Popen):
            raise VoiceRuntimeError(f"could not start {command}")
        return outcome

    def _run(self) -> None:
        while True:
            command, outbox = self._requests.get()
            try:
                outbox.put(
                    subprocess.Popen(
                        [command],
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        stderr=None,
                        bufsize=0,
                    )
                )
            except BaseException as error:  # returned to the caller, never swallowed
                outbox.put(error)


class _LineReader:
    def __init__(self, stream: BinaryIO):
        self._stream = stream
        self._lines: queue.Queue[bytes | Exception | None] = queue.Queue(maxsize=16)
        self._thread = threading.Thread(target=self._read, name="voice-worker-output", daemon=True)
        self._thread.start()

    def next_json(self, timeout_seconds: float) -> dict[str, object]:
        try:
            item = self._lines.get(timeout=timeout_seconds)
        except queue.Empty as error:
            raise VoiceRuntimeError("speech worker response timed out") from error
        if item is None:
            raise VoiceRuntimeError("speech worker closed its output")
        if isinstance(item, Exception):
            raise VoiceRuntimeError(str(item)) from item
        try:
            value = json.loads(item)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise VoiceRuntimeError("speech worker emitted invalid JSON") from error
        if not isinstance(value, dict):
            raise VoiceRuntimeError("speech worker response was not an object")
        return value

    def _read(self) -> None:
        try:
            while True:
                line = self._stream.readline(MAX_JSON_LINE_BYTES + 1)
                if line == b"":
                    self._lines.put(None)
                    return
                if len(line) > MAX_JSON_LINE_BYTES or not line.endswith(b"\n"):
                    self._lines.put(VoiceRuntimeError("speech worker emitted an oversized JSON line"))
                    return
                self._lines.put(line)
        except Exception as error:
            self._lines.put(error)


class _FramedWorker:
    """One persistent worker process behind a JSON-header plus binary-body protocol."""

    def __init__(
        self,
        name: str,
        command: str,
        supervisor: _WorkerSupervisor,
        ready_protocol: str | None,
        startup_seconds: float = 90.0,
    ):
        self.name = name
        self._command = command
        self._supervisor = supervisor
        self._ready_protocol = ready_protocol
        self._startup_seconds = startup_seconds
        self._lock = threading.RLock()
        self._process: subprocess.Popen[bytes] | None = None
        self._responses: _LineReader | None = None
        self._greeted = False

    @property
    def ready(self) -> bool:
        with self._lock:
            return self._alive() and (self._ready_protocol is None or self._greeted)

    def start(self) -> None:
        with self._lock:
            if self.ready:
                return
            self._stop()
            process = self._supervisor.spawn(self._command)
            if process.stdout is None or process.stdin is None:
                raise VoiceRuntimeError(f"{self.name} did not expose its pipes")
            self._process = process
            self._responses = _LineReader(process.stdout)
            if self._ready_protocol is None:
                return
            ready = self._responses.next_json(self._startup_seconds)
            if ready.get("status") != "ready" or ready.get("protocol") != self._ready_protocol:
                self._stop()
                raise VoiceRuntimeError(f"{self.name} emitted an invalid ready record")
            self._greeted = True

    def request(self, header: dict[str, object], body: bytes, timeout_seconds: float) -> dict[str, object]:
        with self._lock:
            self.start()
            process = self._process
            responses = self._responses
            if process is None or responses is None or process.stdin is None:
                raise VoiceRuntimeError(f"{self.name} is unavailable")
            try:
                process.stdin.write(json.dumps(header, separators=(",", ":")).encode("utf-8") + b"\n")
                if body:
                    process.stdin.write(body)
                process.stdin.flush()
            except (BrokenPipeError, OSError) as error:
                self._stop()
                raise VoiceRuntimeError(f"{self.name} request write failed") from error
            try:
                return responses.next_json(timeout_seconds)
            except VoiceRuntimeError:
                self._stop()
                raise

    def close(self) -> None:
        with self._lock:
            self._stop()

    def _alive(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def _stop(self) -> None:
        process = self._process
        self._process = None
        self._responses = None
        self._greeted = False
        if process is None:
            return
        if process.stdin is not None:
            try:
                process.stdin.close()
            except OSError:
                pass
        try:
            process.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


class WhisperWorker(_FramedWorker):
    def __init__(self, command: str, supervisor: _WorkerSupervisor):
        super().__init__("Whisper", command, supervisor, STT_PROTOCOL)

    def transcribe_wav(self, wav: bytes) -> str:
        request_id = uuid.uuid4().hex
        response = self.request(
            {"protocol": STT_PROTOCOL, "requestId": request_id, "kind": "transcribe", "wavBytes": len(wav)},
            wav,
            20.0,
        )
        if response.get("requestId") != request_id:
            raise VoiceRuntimeError("Whisper response ID did not match")
        if response.get("status") != "ready":
            raise VoiceRuntimeError("Whisper transcription failed")
        text = response.get("text")
        if not isinstance(text, str):
            raise VoiceRuntimeError("Whisper returned no text")
        return text.strip()


class SmartTurnWorker(_FramedWorker):
    def __init__(self, command: str, supervisor: _WorkerSupervisor):
        super().__init__("Smart Turn", command, supervisor, TURN_PROTOCOL)

    def check_turn(self, pcm: bytes) -> dict[str, object]:
        if len(pcm) % 4 != 0 or len(pcm) > TURN_WINDOW_BYTES:
            raise VoiceRuntimeError("turn PCM is outside the 8-second float32 window")
        request_id = uuid.uuid4().hex
        response = self.request(
            {"protocol": TURN_PROTOCOL, "requestId": request_id, "kind": "check_turn", "pcmBytes": len(pcm)},
            pcm,
            5.0,
        )
        if response.get("requestId") != request_id:
            raise VoiceRuntimeError("Smart Turn response ID did not match")
        if response.get("status") != "ready":
            raise VoiceRuntimeError("Smart Turn inference failed")
        return {
            "complete": bool(response.get("complete")),
            "probability": float(response.get("probability", 0.0)),
        }


class KokoroWorker(_FramedWorker):
    def __init__(self, command: str, supervisor: _WorkerSupervisor):
        super().__init__("Kokoro", command, supervisor, None)
        self._engine: dict[str, object] | None = None

    @property
    def engine(self) -> dict[str, object] | None:
        return None if self._engine is None else dict(self._engine)

    @property
    def ready(self) -> bool:
        return super().ready and self._engine is not None

    def synthesize(self, text: str, voice: str, output: Path) -> dict[str, object]:
        encoded = text.encode("utf-8")
        if not encoded or len(encoded) > MAX_TTS_TEXT_BYTES:
            raise VoiceRuntimeError("TTS text is outside the 4096-byte worker limit")
        if voice not in TTS_VOICES:
            raise VoiceRuntimeError("TTS voice is not allowlisted")
        output.parent.mkdir(parents=True, exist_ok=True)
        request_id = uuid.uuid4().hex
        response = self.request(
            {
                "protocol": TTS_PROTOCOL,
                "requestId": request_id,
                "voice": voice,
                "text": text,
                "output": str(output),
            },
            b"",
            120.0,
        )
        if response.get("protocol") != TTS_PROTOCOL or response.get("requestId") != request_id:
            raise VoiceRuntimeError("Kokoro response did not match the request")
        if response.get("status") != "ready":
            error = response.get("error")
            raise VoiceRuntimeError(error if isinstance(error, str) else "Kokoro synthesis failed")
        engine = response.get("engine")
        if not isinstance(engine, dict):
            raise VoiceRuntimeError("Kokoro response omitted its engine descriptor")
        if not output.is_file() or output.stat().st_size <= 44:
            raise VoiceRuntimeError("Kokoro did not produce a usable WAV file")
        self._engine = engine
        return dict(engine)


class VoiceRuntime:
    def __init__(self, stt_command: str, tts_command: str, turn_command: str | None = None):
        self._temporary = tempfile.TemporaryDirectory(prefix="voice-content-prototype-")
        self._directory = Path(self._temporary.name)
        self._supervisor = _WorkerSupervisor()
        self.stt = WhisperWorker(stt_command, self._supervisor)
        self.tts = KokoroWorker(tts_command, self._supervisor)
        self.turn = None if turn_command is None else SmartTurnWorker(turn_command, self._supervisor)

    @classmethod
    def from_environment(cls) -> VoiceRuntime:
        stt = os.environ.get("VOICE_CONTENT_STT_WORKER")
        tts = os.environ.get("VOICE_CONTENT_TTS_WORKER")
        turn = os.environ.get("VOICE_CONTENT_TURN_WORKER")
        if not stt or not tts:
            raise VoiceRuntimeError(
                "VOICE_CONTENT_STT_WORKER and VOICE_CONTENT_TTS_WORKER must be set"
            )
        return cls(stt, tts, turn or None)

    def warm(self) -> None:
        # Sequential on purpose: every spawn is delegated to the supervisor thread,
        # and Whisper holds the longest startup, so parallel warmth buys little.
        self.stt.start()
        if self.turn is not None:
            self.turn.start()
        warm_output = self._directory / "warm.wav"
        self.tts.synthesize("The voice runtime is ready.", "af_bella", warm_output)
        warm_output.unlink(missing_ok=True)

    def synthesize(self, text: str, voice: str = "af_bella") -> tuple[bytes, dict[str, object]]:
        output = self._directory / f"tts-{uuid.uuid4().hex}.wav"
        try:
            engine = self.tts.synthesize(text, voice, output)
            return output.read_bytes(), engine
        finally:
            output.unlink(missing_ok=True)

    def transcribe_pcm(self, pcm: bytes) -> str:
        return self.stt.transcribe_wav(float32_pcm_to_wav(pcm))

    def check_turn(self, pcm: bytes) -> dict[str, object]:
        if self.turn is None:
            raise VoiceRuntimeError("Smart Turn is not configured")
        return self.turn.check_turn(pcm)

    def status(self) -> dict[str, object]:
        return {
            "stt": "ready" if self.stt.ready else "unavailable",
            "tts": "ready" if self.tts.ready else "unavailable",
            "turn": "unconfigured" if self.turn is None else ("ready" if self.turn.ready else "unavailable"),
            "audio": {
                "format": "float32le",
                "sampleRate": SAMPLE_RATE,
                "channels": 1,
                "minBytes": MIN_PCM_BYTES,
                "maxBytes": MAX_PCM_BYTES,
                "turnWindowBytes": TURN_WINDOW_BYTES,
            },
            "ttsEngine": self.tts.engine,
            "ttsVoices": sorted(TTS_VOICES),
        }

    def close(self) -> None:
        self.stt.close()
        self.tts.close()
        if self.turn is not None:
            self.turn.close()
        self._temporary.cleanup()

    def __enter__(self) -> VoiceRuntime:
        return self

    def __exit__(self, _error_type: object, _error: object, _traceback: object) -> None:
        self.close()


def float32_pcm_to_wav(pcm: bytes) -> bytes:
    if len(pcm) < MIN_PCM_BYTES:
        raise VoiceRuntimeError("STT PCM is shorter than 100 ms")
    if len(pcm) > MAX_PCM_BYTES:
        raise VoiceRuntimeError("STT PCM exceeds 60 seconds")
    if len(pcm) % 4 != 0:
        raise VoiceRuntimeError("STT PCM does not align to float32 samples")
    sample_count = len(pcm) // 4
    data = bytearray(sample_count * 2)
    for index, (sample,) in enumerate(struct.iter_unpack("<f", pcm)):
        if not math.isfinite(sample) or sample < -1 or sample > 1:
            raise VoiceRuntimeError("STT PCM contains an invalid sample")
        struct.pack_into("<h", data, index * 2, round(sample * 32767))
    header = b"".join(
        [
            b"RIFF",
            struct.pack("<I", 36 + len(data)),
            b"WAVEfmt ",
            struct.pack("<IHHIIHH", 16, 1, 1, SAMPLE_RATE, SAMPLE_RATE * 2, 2, 16),
            b"data",
            struct.pack("<I", len(data)),
        ]
    )
    return header + data
