{
  description = "Disposable comparison of a Nix CI image and Arion NixOS userspace";

  inputs = {
    # Match Yeradon's committed stable lock, not this host's registry.
    nixpkgs.url = "github:NixOS/nixpkgs/21a67dc470149f337cecafbe965d8d252a390518";
    arion.url = "github:hercules-ci/arion/9b24cf65c72cb0e9616e437d55e1ac8e5c6bc715";
    arion.inputs.nixpkgs.follows = "nixpkgs";
    yeradon.url = "github:Yeradon/nixos-ci-image/6c839856889e5b99dbd52a09f50cb7c42cc06207";
    yeradon.inputs.nixpkgs-stable.follows = "nixpkgs";
    # Match the accepted UNZEN package set for an injected-runtime probe.
    unzenPkgs.url = "github:NixOS/nixpkgs/4975466d324710c576dc11ad614684e6bd8cad8e";
  };

  outputs = { self, nixpkgs, arion, unzenPkgs, yeradon }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      mkComposition = module: arion.lib.eval {
        inherit pkgs;
        modules = [ module ];
        uid = "1000";
      };
      composition = mkComposition ./arion-compose.nix;
      compatibleComposition = mkComposition ./arion-compatible.nix;
    in {
      packages.${system} = {
        arionImage = composition.config.services.ci.build.image;
        yeradonCompatible = pkgs.dockerTools.buildLayeredImage {
          name = "forgerie-yeradon-compatible";
          tag = "test";
          # The upstream image already uses the default 100-layer budget.
          maxLayers = 120;
          fromImage = yeradon.packages.${system}.stable;
          contents = [ pkgs.util-linux ];
          # The only package addition is util-linux. Retain the upstream paths.
          config.Env = [
            "PATH=${pkgs.lib.makeBinPath (with pkgs; [ util-linux bashInteractive coreutils gnugrep gnused gawk findutils gnutar gzip xz which curl openssh git git-lfs nix nodejs zstd glibc stdenv.cc.cc.lib ])}:/usr/bin:/bin"
            "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
            "NIX_SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
            "NIX_PATH=nixpkgs=${pkgs.path}"
            "HOME=/root"
            "USER=root"
            "NIX_LD=${pkgs.glibc}/lib/ld-linux-x86-64.so.2"
            "NIX_LD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath [ pkgs.glibc pkgs.stdenv.cc.cc.lib pkgs.zlib ]}"
          ];
          config.WorkingDir = "/home/runner/_work";
        };
        arionCompose = composition.config.out.dockerComposeYaml;
        arionCompatibleImage = compatibleComposition.config.services.ci.build.image;
        arionCompatibleCompose = compatibleComposition.config.out.dockerComposeYaml;
        nativeRunner = unzenPkgs.legacyPackages.${system}.github-runner;
        runnerSource = unzenPkgs.legacyPackages.${system}.github-runner.src;
        node24 = pkgs.nodejs_24;
      };
      # Capture the actual Arion output rather than inventing a Podman command.
      lib.service = composition.config.services.ci.out.service;
    };
}
