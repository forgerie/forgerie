{ pkgs, ... }: {
  imports = [ ./arion-compose.nix ];
  services.ci.nixos.configuration = {
    # The outer cgroup already bounds memory. Do not add SYS_ADMIN for oomd.
    systemd.oomd.enable = false;
    programs.nix-ld = {
      enable = true;
      libraries = [ pkgs.stdenv.cc.cc.lib pkgs.zlib ];
    };
    environment.systemPackages = [ pkgs.util-linux ];
    users.groups.ci.gid = 1000;
    users.users.ci = {
      isNormalUser = true;
      uid = 1000;
      group = "ci";
      home = "/tmp/ci-home";
      createHome = true;
    };
  };
}
