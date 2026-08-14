{ pkgs }:

let
  python = pkgs.python3;
  model = pkgs.fetchurl {
    url = "https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/f766f81d3cfdf7737ac64aad813d91bbfd56bf93/smart-turn-v3.2-cpu.onnx";
    hash = "sha256-K7AmMWsUpmBIanWxczzT+6uML9AxTcmve+SfjMqWfk8=";
  };
  pythonEnvironment = python.withPackages (packages: [
    packages.numpy
    packages.onnxruntime
    packages.transformers
  ]);
in
pkgs.writeShellApplication {
  name = "forgerie-smart-turn-worker";
  runtimeInputs = [ pkgs.bubblewrap pythonEnvironment ];
  text = ''
    exec bwrap \
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
      --setenv SMART_TURN_MODEL ${model} \
      --setenv SMART_TURN_MAX_PCM_BYTES 3840000 \
      --setenv HF_HUB_OFFLINE 1 \
      --setenv TRANSFORMERS_OFFLINE 1 \
      --chdir /tmp \
      ${pythonEnvironment}/bin/python ${../speech/smart_turn_worker.py}
  '';
}
