{
  project.name = "forgerie-ci-routes";
  services.ci = { pkgs, lib, ... }: {
    nixos.useSystemd = true;
    # Export a self-contained image. Never mount the host store or daemon.
    service.useHostStore = false;
    nixos.configuration = {
      system.stateVersion = "26.05";
      networking.useDHCP = false;
      boot.tmp.useTmpfs = false;
      nix.enable = false;
      services.nscd.enable = false;
      system.nssModules = lib.mkForce [];
      environment.systemPackages = with pkgs; [
        nodejs_24 git bashInteractive coreutils curl gnutar gzip zstd
      ];
      systemd.services.ci-probe = {
        description = "Prove systemd started the declared Node toolchain";
        wantedBy = [ "multi-user.target" ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          ExecStart = "${pkgs.nodejs_24}/bin/node -p process.versions.node";
          ExecStartPost = "${pkgs.coreutils}/bin/touch /run/ci-probe-ready";
        };
      };
    };
  };
}
