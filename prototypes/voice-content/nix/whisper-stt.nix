# Prototype snapshot of Forgerie's packaged whisper.cpp worker.
{ pkgs }:

let
  modelRevision = "5359861c739e955e79d9a303bcbc70fb988958b1";
  model = pkgs.fetchurl {
    url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/${modelRevision}/ggml-base.en.bin";
    hash = "sha256-oDd5yG3zMjB19eeWyyzlAp8A7Ihp7uP9+4l6/jbG0AI=";
  };
  python = pkgs.python3;
in
pkgs.writeShellApplication {
  name = "voice-content-whisper-worker";
  runtimeInputs = [
    pkgs.bubblewrap
    python
  ];
  text = ''
    exec ${pkgs.bubblewrap}/bin/bwrap \
      --die-with-parent \
      --unshare-pid \
      --unshare-ipc \
      --unshare-net \
      --new-session \
      --clearenv \
      --ro-bind /nix/store /nix/store \
      --proc /proc \
      --dev /dev \
      --tmpfs /tmp \
      --tmpfs /home \
      --tmpfs /root \
      --setenv HOME /tmp \
      --setenv WHISPER_MODEL ${model} \
      --setenv WHISPER_SERVER ${pkgs.whisper-cpp}/bin/whisper-server \
      --setenv WHISPER_IP_COMMAND ${pkgs.iproute2}/bin/ip \
      --setenv WHISPER_MAX_WAV_BYTES 1920044 \
      --setenv WHISPER_MAX_RESPONSE_BYTES 65536 \
      --setenv WHISPER_MAX_TRANSCRIPT_CHARS 4096 \
      --setenv WHISPER_WARMUP_TIMEOUT_MS 60000 \
      --setenv WHISPER_REQUEST_TIMEOUT_MS 10000 \
      --chdir /tmp \
      ${python}/bin/python ${../workers/whisper_worker.py}
  '';
}
