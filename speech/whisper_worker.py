#!/usr/bin/env python3
"""Persistent Forgerie whisper.cpp transcription worker.

The worker owns whisper-server inside the same sandbox and exposes only a
bounded stdin/stdout protocol to Node:

- ready: one JSON line, {"status":"ready","protocol":PROTOCOL}
- request: one JSON header line with wavBytes, followed by exactly that many
  WAV bytes
- response: one correlated JSON line with either status "ready" and text, or
  status "error"
"""

import json
import os
import secrets
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import BinaryIO

PROTOCOL = "forgerie-whisper-worker-v1"
HOST = "127.0.0.1"
PORT = 8790
MAX_HEADER_BYTES = 4096
DEFAULT_MAX_WAV_BYTES = 1_920_044
DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024
DEFAULT_MAX_TRANSCRIPT_CHARS = 4096
DEFAULT_WARMUP_TIMEOUT_MS = 60_000
DEFAULT_REQUEST_TIMEOUT_MS = 10_000


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def bring_loopback_up() -> None:
    ip_command = os.environ["WHISPER_IP_COMMAND"]
    completed = subprocess.run(
        [ip_command, "link", "set", "lo", "up"],
        check=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        timeout=5,
    )
    if completed.returncode != 0:
        sys.stderr.write("Could not set loopback up; continuing with namespace-local loopback probe.\n")
        sys.stderr.write(completed.stderr.decode("utf-8", errors="replace"))
        sys.stderr.flush()


def start_server() -> subprocess.Popen[bytes]:
    whisper_server = os.environ["WHISPER_SERVER"]
    model = os.environ["WHISPER_MODEL"]
    return subprocess.Popen(
        [
            whisper_server,
            "--model",
            model,
            "--host",
            HOST,
            "--port",
            str(PORT),
            "--language",
            "en",
            "--no-timestamps",
            "--suppress-nst",
        ],
        stdin=subprocess.DEVNULL,
        stdout=sys.stderr,
        stderr=sys.stderr,
    )


def wav_silence() -> bytes:
    data = b"\x00\x00" * 160
    byte_rate = 16_000 * 2
    block_align = 2
    return b"".join(
        [
            b"RIFF",
            (36 + len(data)).to_bytes(4, "little"),
            b"WAVEfmt ",
            (16).to_bytes(4, "little"),
            (1).to_bytes(2, "little"),
            (1).to_bytes(2, "little"),
            (16_000).to_bytes(4, "little"),
            byte_rate.to_bytes(4, "little"),
            block_align.to_bytes(2, "little"),
            (16).to_bytes(2, "little"),
            b"data",
            len(data).to_bytes(4, "little"),
            data,
        ]
    )


def multipart_wav_body(wav: bytes) -> tuple[bytes, str]:
    boundary = f"forgerie-speech-boundary-{secrets.token_hex(16)}"
    body = b"".join(
        [
            f"--{boundary}\r\ncontent-disposition: form-data; name=\"file\"; filename=\"speech.wav\"\r\ncontent-type: audio/wav\r\n\r\n".encode(),
            wav,
            f"\r\n--{boundary}\r\ncontent-disposition: form-data; name=\"response_format\"\r\n\r\njson\r\n--{boundary}--\r\n".encode(),
        ]
    )
    return body, f"multipart/form-data; boundary={boundary}"


def post_inference(wav: bytes, timeout_ms: int, max_response_bytes: int) -> dict[str, object]:
    body, content_type = multipart_wav_body(wav)
    request = urllib.request.Request(
        f"http://{HOST}:{PORT}/inference",
        data=body,
        headers={"content-type": content_type},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=max(0.001, timeout_ms / 1000)) as response:
            raw = response.read(max_response_bytes + 1)
            if len(raw) > max_response_bytes:
                raise ValueError("Whisper response exceeded the byte limit")
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"Whisper inference failed with HTTP {response.status}")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Whisper inference failed with HTTP {error.code}") from error
    parsed = json.loads(raw.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("Whisper response was not a JSON object")
    return parsed


def wait_ready(process: subprocess.Popen[bytes], timeout_ms: int, max_response_bytes: int) -> None:
    deadline = time.monotonic() + timeout_ms / 1000
    wav = wav_silence()
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("whisper-server exited before readiness")
        remaining_ms = max(1, int((deadline - time.monotonic()) * 1000))
        try:
            response = post_inference(wav, remaining_ms, max_response_bytes)
            if not isinstance(response.get("text"), str):
                raise ValueError("Whisper readiness response did not contain text")
            return
        except Exception as error:  # readiness retries until the warmup deadline
            last_error = error
            time.sleep(0.05)
    raise TimeoutError(f"Timed out waiting for whisper-server readiness: {last_error}")


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


def handle_request(header: dict[str, object], wav: bytes, max_response_bytes: int, max_transcript_chars: int, request_timeout_ms: int) -> dict[str, object]:
    request_id = header.get("requestId")
    try:
        if header.get("protocol") != PROTOCOL:
            raise ValueError("unsupported protocol")
        if header.get("kind") != "transcribe":
            raise ValueError("unsupported request kind")
        parsed = post_inference(wav, request_timeout_ms, max_response_bytes)
        text = parsed.get("text")
        if not isinstance(text, str):
            raise ValueError("Whisper response JSON did not contain text")
        if len(text) > max_transcript_chars:
            raise ValueError("Whisper transcript exceeded the text limit")
        return {"requestId": request_id, "status": "ready", "text": text}
    except Exception as error:
        return {"requestId": request_id, "status": "error", "error": str(error)}


def stop_server(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass


def main() -> None:
    max_wav_bytes = env_int("WHISPER_MAX_WAV_BYTES", DEFAULT_MAX_WAV_BYTES)
    max_response_bytes = env_int("WHISPER_MAX_RESPONSE_BYTES", DEFAULT_MAX_RESPONSE_BYTES)
    max_transcript_chars = env_int("WHISPER_MAX_TRANSCRIPT_CHARS", DEFAULT_MAX_TRANSCRIPT_CHARS)
    warmup_timeout_ms = env_int("WHISPER_WARMUP_TIMEOUT_MS", DEFAULT_WARMUP_TIMEOUT_MS)
    request_timeout_ms = env_int("WHISPER_REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS)

    server: subprocess.Popen[bytes] | None = None

    def terminate(_signum: int, _frame: object) -> None:
        if server is not None:
            stop_server(server)
        raise SystemExit(143)

    signal.signal(signal.SIGTERM, terminate)

    try:
        bring_loopback_up()
        server = start_server()
        wait_ready(server, warmup_timeout_ms, max_response_bytes)
        response({"status": "ready", "protocol": PROTOCOL})

        stream = sys.stdin.buffer
        while True:
            header = read_header(stream)
            if header is None:
                return
            request_id = header.get("requestId")
            wav_bytes = header.get("wavBytes")
            if type(wav_bytes) is not int or wav_bytes < 0 or wav_bytes > max_wav_bytes:
                response({"requestId": request_id, "status": "error", "error": "invalid wavBytes"})
                return
            wav = read_exact(stream, wav_bytes)
            response(handle_request(header, wav, max_response_bytes, max_transcript_chars, request_timeout_ms))
    finally:
        if server is not None:
            stop_server(server)


if __name__ == "__main__":
    main()
