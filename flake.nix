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
        smartTurnWorker = import ./nix/smart-turn.nix { inherit pkgs; };
        whisperSttServer = import ./nix/whisper-stt.nix { inherit pkgs; };
      in
      {
        packages = nixpkgs.lib.optionalAttrs (system == "x86_64-linux") {
          forgerie-smart-turn-worker = smartTurnWorker;
          forgerie-whisper-stt-server = whisperSttServer;
        };

        apps = nixpkgs.lib.optionalAttrs (system == "x86_64-linux") {
          forgerie-smart-turn-worker = {
            type = "app";
            program = "${smartTurnWorker}/bin/forgerie-smart-turn-worker";
          };
          forgerie-whisper-stt-server = {
            type = "app";
            program = "${whisperSttServer}/bin/forgerie-whisper-stt-server";
          };
        };
      }
    );
}
