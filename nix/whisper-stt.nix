{ pkgs }:

let
  modelRevision = "5359861c739e955e79d9a303bcbc70fb988958b1";
  model = pkgs.fetchurl {
    url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/${modelRevision}/ggml-base.en.bin";
    hash = "sha256-oDd5yG3zMjB19eeWyyzlAp8A7Ihp7uP9+4l6/jbG0AI=";
  };
in
pkgs.writeShellApplication {
  name = "forgerie-whisper-stt-server";
  runtimeInputs = [ pkgs.whisper-cpp ];
  text = ''
    port="''${1:-8790}"
    exec whisper-server \
      --model ${model} \
      --host 127.0.0.1 \
      --port "$port" \
      --language en \
      --no-timestamps \
      --suppress-nst
  '';
}
