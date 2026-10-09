{
  description = "Forgerie — browser control surface for persistent Pi Coding Agent sessions";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs
    , flake-utils
    , ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        whisperSttWorker = import ./nix/whisper-stt.nix { inherit pkgs; };
      in
      {
        packages = nixpkgs.lib.optionalAttrs (system == "x86_64-linux") {
          forgerie-whisper-stt-worker = whisperSttWorker;
        };

        apps = nixpkgs.lib.optionalAttrs (system == "x86_64-linux") {
          forgerie-whisper-stt-worker = {
            type = "app";
            program = "${whisperSttWorker}/bin/forgerie-whisper-stt-worker";
          };
        };
      }
    );
}
