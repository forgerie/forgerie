# Prototype snapshot of Comics' packaged CUDA Kokoro worker.
{ nixpkgs, system }:

let
  pkgs = import nixpkgs {
    inherit system;
    config = {
      allowUnfree = true;
      cudaCapabilities = [ "8.6" ];
    };
  };

  python = pkgs.python313.override {
    packageOverrides = final: previous: {
      spacy-loggers = previous.spacy-loggers.overridePythonAttrs (old: {
        dependencies = builtins.filter (dependency: (dependency.pname or "") != "wandb") old.dependencies;
      });

      torch = previous.torch-bin.overrideAttrs (old: {
        dontCheckRuntimeDeps = true;
        postInstall = (old.postInstall or "") + ''
          find "$out/${python.sitePackages}" -path '*/torch-*.dist-info/METADATA' \
            -exec sed -i '/^Requires-Dist: \(cuda-bindings\|fsspec\|nvidia-.*-cu12\)/d' {} +
        '';
        passthru = (old.passthru or { }) // {
          cudaSupport = true;
          cudaCapabilities = [ "8.6" ];
          cudaPackages = pkgs.cudaPackages;
          cxxdev = final.torch;
          dev = final.torch;
        };
      });
    };
  };

  modelRevision = "f3ff3571791e39611d31c381e3a41a3af07b4987";
  kokoroConfig = pkgs.fetchurl {
    url = "https://huggingface.co/hexgrad/Kokoro-82M/resolve/${modelRevision}/config.json";
    hash = "sha256-WrsB4kA7ByvwPQT94WBEPiCdeg2tSaQjvhUZa5tDwX8=";
  };
  kokoroModel = pkgs.fetchurl {
    url = "https://huggingface.co/hexgrad/Kokoro-82M/resolve/${modelRevision}/kokoro-v1_0.pth";
    hash = "sha256-SW26EY0aWPXz2y78iNvcIW4Eg/yJ/m5H7h8sU/GK0eQ=";
  };
  bellaVoice = pkgs.fetchurl {
    url = "https://huggingface.co/hexgrad/Kokoro-82M/resolve/${modelRevision}/voices/af_bella.pt";
    hash = "sha256-jLZOAvzI3gMnqOE4F+ScdslF7PAFLOrJfTCBSA6OSNY=";
  };
  heartVoice = pkgs.fetchurl {
    url = "https://huggingface.co/hexgrad/Kokoro-82M/resolve/${modelRevision}/voices/af_heart.pt";
    hash = "sha256-CrVwm4/6sZv9hJzRHZj3W2CvdzMlOtDWexI4KhAstP8=";
  };

  enCoreWebSm = python.pkgs.buildPythonPackage {
    pname = "en-core-web-sm";
    version = "3.8.0";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl";
      hash = "sha256-GTJCnbcn1L/z3u1rNM/AXfF3lPSlLusmz4ko98Gg+4U=";
    };
    dependencies = [ python.pkgs.spacy ];
    doCheck = false;
  };

  pythonEnvironment = python.withPackages (packages: [
    packages.kokoro
    packages.soundfile
    enCoreWebSm
  ]);

  driverLibraryPath = "/run/opengl-driver/lib";
in
pkgs.writeShellApplication {
  name = "voice-content-kokoro-worker";
  runtimeInputs = [ pythonEnvironment ];
  text = ''
    export LD_LIBRARY_PATH="${driverLibraryPath}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
    export KOKORO_CONFIG=${kokoroConfig}
    export KOKORO_MODEL=${kokoroModel}
    export KOKORO_BELLA=${bellaVoice}
    export KOKORO_HEART=${heartVoice}
    export KOKORO_MODEL_REVISION=${modelRevision}
    export KOKORO_MODEL_DIGEST=03a6ebddf6b50c9969e87aa0e04dc912c85d6ad87c13b66f2b5bbfa88b89fc93
    export KOKORO_BELLA_DIGEST=e46bb48b35bf6b60fc96ad0226dcf4bc1d6eb07221b6b061ae0e5b9e9a215758
    export KOKORO_HEART_DIGEST=93fe99c9d1b8a6ab2b1b9af88427342bd6b55a9ecc5b13068801f3286fb963be
    exec python ${../workers/kokoro_worker.py}
  '';
}
