{
  description = "Throwaway voice plus content prototype";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/e72e4f299401a3689d4b3d5fc6496b11db7064eb";
    nixpkgsTts.url = "github:NixOS/nixpkgs/c06b4ae3d6599a672a6210b7021d699c351eebda";
  };

  outputs =
    {
      nixpkgs,
      nixpkgsTts,
      ...
    }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      source = ./.;
      sttWorker = import ./nix/whisper-stt.nix { inherit pkgs; };
      turnWorker = import ./nix/smart-turn.nix { inherit pkgs; };
      ttsWorker = import ./nix/kokoro-tts-cuda.nix {
        nixpkgs = nixpkgsTts;
        inherit system;
      };
      workerEnvironment = ''
        export VOICE_CONTENT_STT_WORKER=${sttWorker}/bin/voice-content-whisper-worker
        export VOICE_CONTENT_TURN_WORKER=${turnWorker}/bin/voice-content-turn-worker
        export VOICE_CONTENT_TTS_WORKER=${ttsWorker}/bin/voice-content-kokoro-worker
      '';
      server = pkgs.writeShellApplication {
        name = "voice-content-prototype";
        runtimeInputs = [ pkgs.python3 ];
        text = ''
          ${workerEnvironment}
          exec ${pkgs.python3}/bin/python ${source}/server.py "$@"
        '';
      };
      smoke = pkgs.writeShellApplication {
        name = "voice-content-smoke";
        runtimeInputs = [
          pkgs.python3
          pkgs.ffmpeg
        ];
        text = ''
          ${workerEnvironment}
          exec ${pkgs.python3}/bin/python ${source}/smoke.py "$@"
        '';
      };
    in
    {
      packages.${system} = {
        default = server;
        inherit server smoke;
        stt-worker = sttWorker;
        turn-worker = turnWorker;
        tts-worker = ttsWorker;
      };

      apps.${system} = {
        default = {
          type = "app";
          program = "${server}/bin/voice-content-prototype";
        };
        smoke = {
          type = "app";
          program = "${smoke}/bin/voice-content-smoke";
        };
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.curl
          pkgs.ffmpeg
          pkgs.python3
          sttWorker
          turnWorker
          ttsWorker
        ];
        shellHook = workerEnvironment;
      };
    };
}
