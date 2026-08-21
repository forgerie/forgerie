#!/usr/bin/env python3
"""PROTOTYPE HTTP process: real STT, real TTS, real turn detection, static UI."""

from __future__ import annotations

import argparse
import json
import logging
import mimetypes
import signal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from voice_runtime import (
    MAX_PCM_BYTES,
    MAX_TTS_TEXT_BYTES,
    TURN_WINDOW_BYTES,
    VoiceRuntime,
    VoiceRuntimeError,
)

LOGGER = logging.getLogger("voice-content-prototype")
MAX_TTS_REQUEST_BYTES = MAX_TTS_TEXT_BYTES + 1024
SERVED_SUFFIXES = frozenset({".html", ".css", ".js", ".json", ".svg", ".png", ".ico", ".woff2"})
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def authority_hostname(authority: str | None) -> str | None:
    if authority is None or not authority.strip():
        return None
    value = authority.strip()
    if value == "::1":
        return value
    try:
        return urlsplit(f"//{value}").hostname
    except ValueError:
        return None


def local_request_allowed(host: str | None, origin: str | None) -> bool:
    if authority_hostname(host) not in LOOPBACK_HOSTS:
        return False
    if origin is None:
        return True
    try:
        parsed = urlsplit(origin)
    except ValueError:
        return False
    return parsed.scheme in {"http", "https"} and parsed.hostname in LOOPBACK_HOSTS


class RequestError(ValueError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class VoiceHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        address: tuple[str, int],
        runtime: VoiceRuntime,
        web_root: Path,
        allow_remote_requests: bool = False,
    ):
        super().__init__(address, VoiceRequestHandler)
        self.runtime = runtime
        self.web_root = web_root
        self.allow_remote_requests = allow_remote_requests


class VoiceRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "voice-content-prototype"

    @property
    def voice_server(self) -> VoiceHttpServer:
        return self.server  # type: ignore[return-value]

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        try:
            self._require_allowed_request()
            if path == "/api/status":
                self._send_json(200, self.voice_server.runtime.status())
                return
            self._serve_file(path)
        except RequestError as error:
            self._send_json(error.status, {"error": str(error)})
        except Exception:
            LOGGER.exception("unhandled GET failure")
            self._send_json(500, {"error": "Request failed."})

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        try:
            self._require_allowed_request()
            if path == "/api/tts":
                self._handle_tts()
                return
            if path == "/api/stt":
                self._handle_stt()
                return
            if path == "/api/check-turn":
                self._handle_check_turn()
                return
            raise RequestError(404, "Route not found.")
        except RequestError as error:
            self._send_json(error.status, {"error": str(error)})
        except VoiceRuntimeError as error:
            LOGGER.error("speech operation failed: %s", error)
            self._send_json(502, {"error": str(error)})
        except Exception:
            LOGGER.exception("unhandled speech request failure")
            self._send_json(500, {"error": "Speech request failed."})

    def _handle_tts(self) -> None:
        self._require_content_type("application/json")
        body = self._read_body(MAX_TTS_REQUEST_BYTES)
        try:
            value = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RequestError(400, "TTS body must be valid JSON.") from error
        if not isinstance(value, dict):
            raise RequestError(400, "TTS body must be a JSON object.")
        text = value.get("text")
        voice = value.get("voice", "af_bella")
        if not isinstance(text, str) or not text.strip():
            raise RequestError(400, "TTS text must be a non-empty string.")
        if not isinstance(voice, str):
            raise RequestError(400, "TTS voice must be a string.")
        wav, engine = self.voice_server.runtime.synthesize(text.strip(), voice)
        self._send_bytes(
            200,
            wav,
            "audio/wav",
            {"X-Voice": voice, "X-Sample-Rate": str(engine.get("sampleRate", 24_000))},
        )

    def _handle_stt(self) -> None:
        self._require_content_type("application/octet-stream")
        pcm = self._read_body(MAX_PCM_BYTES)
        text = self.voice_server.runtime.transcribe_pcm(pcm)
        self._send_json(200, {"text": text})

    def _handle_check_turn(self) -> None:
        self._require_content_type("application/octet-stream")
        pcm = self._read_body(TURN_WINDOW_BYTES)
        self._send_json(200, self.voice_server.runtime.check_turn(pcm))

    def _serve_file(self, path: str) -> None:
        root = self.voice_server.web_root
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (root / relative).resolve()
        if not target.is_relative_to(root.resolve()) or target.suffix not in SERVED_SUFFIXES:
            raise RequestError(404, "Not found.")
        if not target.is_file():
            raise RequestError(404, "Not found.")
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self._send_bytes(200, target.read_bytes(), content_type)

    def _require_allowed_request(self) -> None:
        if self.voice_server.allow_remote_requests:
            return
        if not local_request_allowed(self.headers.get("host"), self.headers.get("origin")):
            raise RequestError(403, "Only loopback Host and Origin values are allowed.")

    def _require_content_type(self, expected: str) -> None:
        actual = self.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if actual != expected:
            raise RequestError(415, f"Content-Type must be {expected}.")

    def _read_body(self, limit: int) -> bytes:
        header = self.headers.get("content-length")
        if header is None or not header.isdigit():
            raise RequestError(411, "A valid Content-Length header is required.")
        length = int(header)
        if length <= 0:
            raise RequestError(400, "Request body is empty.")
        if length > limit:
            raise RequestError(413, "Request body exceeds the route limit.")
        body = self.rfile.read(length)
        if len(body) != length:
            raise RequestError(400, "Request body ended before Content-Length.")
        return body

    def _send_json(self, status: int, value: object) -> None:
        payload = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self._send_bytes(status, payload, "application/json; charset=utf-8")

    def _send_bytes(
        self,
        status: int,
        payload: bytes,
        content_type: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        if headers is not None:
            for name, value in headers.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
        LOGGER.debug("http %s", format % args)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the voice plus content prototype.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8788)
    parser.add_argument(
        "--unsafe-allow-remote",
        action="store_true",
        help="Allow non-loopback binding and disable Host/Origin checks. Use only behind a trusted proxy.",
    )
    parser.add_argument(
        "--web",
        type=Path,
        default=Path(__file__).resolve().parent / "web",
        help="Directory served at /. Point this at a working tree to edit without rebuilding.",
    )
    return parser.parse_args()


def main() -> int:
    args = arguments()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    web_root = args.web.resolve()
    if not web_root.is_dir():
        raise SystemExit(f"web directory does not exist: {web_root}")
    if authority_hostname(args.host) not in LOOPBACK_HOSTS and not args.unsafe_allow_remote:
        raise SystemExit("non-loopback --host requires --unsafe-allow-remote")
    with VoiceRuntime.from_environment() as runtime:
        server = VoiceHttpServer(
            (args.host, args.port),
            runtime,
            web_root,
            allow_remote_requests=args.unsafe_allow_remote,
        )
        try:
            LOGGER.info("warming Whisper, Smart Turn, and Kokoro")
            runtime.warm()

            def stop(_signal_number: int, _frame: object) -> None:
                raise KeyboardInterrupt

            signal.signal(signal.SIGTERM, stop)
            LOGGER.info("serving %s at http://%s:%d", web_root, args.host, args.port)
            try:
                server.serve_forever(poll_interval=0.2)
            except KeyboardInterrupt:
                LOGGER.info("stopping the prototype")
        finally:
            server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
