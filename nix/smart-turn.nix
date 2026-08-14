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
  runtimeInputs = [ pythonEnvironment ];
  text = ''
    export SMART_TURN_MODEL=${model}
    export HF_HUB_OFFLINE=1
    export TRANSFORMERS_OFFLINE=1
    exec python ${../speech/smart_turn_worker.py}
  '';
}
