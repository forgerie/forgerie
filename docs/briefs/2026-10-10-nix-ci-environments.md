# Nix containers and NixOS environments for GitHub Actions

Research date: 2026-10-10. This is an options assessment, not an approved deployment change.

## Finding

A shared, Nix-built container image is feasible. Full NixOS containers and NixOS test VMs also exist. These are different levels of environment consistency. A container does not supply a private kernel; a Nix-built image is not automatically a booted NixOS system.

The source-research stage changed no workflow, runner policy or host service. The later disposable tests used a dedicated hosted workflow branch. The accepted UNZEN pilot remains native, trusted-main-only and optional. The earlier restriction on a production VM remains in force; disposable test VMs remain permitted.

## Options

| Approach | What can match across UNZEN and GitHub-hosted Linux | What remains host-dependent | Cost or limitation |
| --- | --- | --- | --- |
| Pinned Nix shell or tool closure | Tool versions and their runtime dependencies. | Kernel, filesystem, system services and surrounding environment. | Smallest change, but less environment control. UNZEN jobs currently cannot call the host Nix daemon. |
| Prebuilt Nix OCI image | Tools, libraries, image root filesystem and configured environment, when both run the same architecture-specific image digest. | Kernel, bind-mounted workspace, CPU and runtime configuration. | Image build/publication and container-runtime integration. GitHub's injected action runtime is an additional compatibility boundary. |
| Full NixOS container | Declarative NixOS userspace and systemd services. | Host kernel and container isolation/runtime. | More integration, cgroup and privilege work. It is not a universal drop-in GitHub job image. |
| NixOS test VM | Declared guest OS, guest kernel and chosen guest filesystem. | Physical CPU, virtualization support and host I/O. | Larger downloads, guest boot and test-driver integration. KVM availability must be checked. |

Sources: [Nix Docker manual](https://nix.dev/manual/nix/latest/installation/installing-docker.html), [NixOS containers](https://github.com/NixOS/nixpkgs/blob/nixos-26.05/nixos/doc/manual/administration/containers.chapter.md), [Arion](https://docs.hercules-ci.com/arion/), [NixOS VM tests](https://nix.dev/tutorials/nixos/integration-testing-using-virtual-machines.html).

## Existing implementations checked

### Official Nix image and image builders

The official `docker.io/nixos/nix` image exists. Its manual states that `dockerTools.buildLayeredImage` builds it from Nix and a minimal set of dependencies, without another distribution as its base. This provides Nix in a container, not the complete NixOS service system. The displayed old version numbers in the manual's command output are examples, not a verified current image version. [Source](https://nix.dev/manual/nix/latest/installation/installing-docker.html).

Nix's official tutorial shows how to build and run Docker images with `dockerTools`. This is the standard-library option for our own prebuilt test environment. [Source](https://nix.dev/tutorials/nixos/building-and-running-docker-images.html).

`nlewo/nix2container` is a real alternative image builder. Its documentation shows loading an image into Docker and Podman. It supports explicit dependency layers and optional initialization of the Nix store database. This last option matters only when running Nix itself inside the image; a prebuilt Node test image does not need runtime Nix builds. Its published informal benchmarks are not estimates for Forgerie. [Source](https://github.com/nlewo/nix2container).

### A purpose-built GitHub Actions Nix image

`Yeradon/nixos-ci-image` publishes a Nix-built CI-image recipe. I inspected its [image source](https://github.com/Yeradon/nixos-ci-image/blob/main/flake.nix) and [build workflow](https://github.com/Yeradon/nixos-ci-image/blob/main/.github/workflows/build.yml), not only its README.

The source uses `dockerTools.buildLayeredImage`, includes shell tools, Git, Nix and Node, and adds `nix-ld` and library symlinks for foreign GitHub action binaries. It writes a synthetic `/etc/os-release`; it does not boot a NixOS kernel or systemd. It disables Nix sandboxing and syscall filtering inside the image.

Its workflow builds the image on `ubuntu-latest` and publishes tags to GHCR. This verifies a concrete image-building workflow definition. It does not prove that this exact image passes our workflow or a current standard NixOS runner's mounted Node closure. The recipe was untested at the source-research stage. The later experiments below test the original image and a compatibility overlay; they do not approve production use. [README](https://github.com/Yeradon/nixos-ci-image).

### Full NixOS containers

NixOS has native declarative containers that share the host Nix store. The manual explicitly warns that container root can affect the host. It therefore does not establish a safe boundary for untrusted jobs. [Source](https://github.com/NixOS/nixpkgs/blob/nixos-26.05/nixos/doc/manual/administration/containers.chapter.md).

Arion goes further than a package-only image: it documents plain-command containers, individual NixOS services and full NixOS userspace with systemd. Its full-system example uses `nixos.useSystemd = true`. Its documented modern full-NixOS path uses Podman with Docker Compose. Arion reports success on other Linux distributions but says its own CI tests only NixOS. This is evidence that full NixOS containers exist, not proof of GitHub-hosted compatibility for our job. [Source and example](https://docs.hercules-ci.com/arion/).

### Full NixOS test VMs

The official NixOS test driver runs declaratively configured guests under QEMU and can run on Linux without the host being NixOS. This gives a common guest OS instead of only common tools. Successful Nix test results are cached; checking a cached result is not a fresh guest execution. [Source](https://nix.dev/tutorials/nixos/integration-testing-using-virtual-machines.html).

Cachix's installer explicitly supports NixOS tests and enables KVM when available. Its [`action.yml`](https://github.com/cachix/install-nix-action/blob/master/action.yml) defaults `enable_kvm` to true. Its [README](https://github.com/cachix/install-nix-action) shows the NixOS-test system features. The Nix tutorial also documents a software-emulation fallback. These sources do not guarantee `/dev/kvm` on every runner label; verify the chosen hosted Linux image before relying on acceleration.

## GitHub integration boundaries

GitHub supports a [job-level `container:` image](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/run-jobs-in-a-container). Its default script shell is `sh`, not `bash`. Default self-hosted container support requires Linux and Docker. [Requirements](https://docs.github.com/en/actions/reference/runners/self-hosted-runners).

GitHub also documents [custom container hooks](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/customize-containers) for Podman or Kubernetes. The feature is in public preview. It runs under the runner service account, and GitHub documents no built-in hook timeout. It therefore adds integration and lifecycle ownership rather than eliminating them.

There is a specific NixOS problem to avoid. [Nixpkgs issue #306373](https://github.com/NixOS/nixpkgs/issues/306373) reports job containers failing because the runner injects a Node executable whose Nix-store dependencies are outside the container. A participant confirms that mounting `/nix` worked for their case. That is a historical workaround, not an approved mount policy for UNZEN. The fetched issue remains open. Adding Node to `PATH` inside an image does not automatically replace the runner's injected Node executable.

A lower-coupling alternative is to leave checkout and artifact actions on each runner, and explicitly run only the build/test command in a digest-pinned OCI image. This avoids moving GitHub's JavaScript action plumbing into the test image. The later hosted comparison tests this pattern with Forgerie's existing commands. Its compatibility with the restricted UNZEN Service remains untested.

## Fit for this pilot

Opinion: the best first experiment is a prebuilt, project-owned OCI test image, not a containerized replacement runner. Build it from one pinned Nix package set, publish an immutable image digest, and run the same test payload on both placements. Keep GitHub's queue, logs, checks and native UNZEN registration service.

This can keep runtime test work independent of the host Nix daemon. It still requires a container runtime and validation of our UID mapping, network restrictions, cancellation, cleanup and resource accounting. Containers started by another daemon must not escape the current CI resource bounds. A privileged Docker socket is not a harmless tool addition. [Docker rootless requirements](https://docs.docker.com/engine/security/rootless/).

If the goal includes systemd and OS-service behavior, full NixOS containers are a separate option. If the goal includes the same kernel and filesystem behavior, use a disposable NixOS test VM. Neither proposal authorizes replacing the current production runner placement.

A shared image does not make a host-mounted bcachefs checkout behave like another filesystem. The inode bug found during the pilot remains a reason to retain a native-host check alongside more uniform environments.

## Executed comparison

After the user authorized both routes, the experiments ran locally on ZAO with isolated rootless Podman and on two sequential GitHub-hosted Ubuntu jobs. The application source was frozen at `09e3ef5e2ab8cf369a346915a6469a099a6cb616`. [Hosted run 38089572231](https://github.com/forgerie/forgerie/actions/runs/38089572231) passed. Its downloaded receipts, coverage and actual job logs were checked.

| Check | Yeradon route | Arion full-system route |
| --- | --- | --- |
| Original baseline | Static checks pass; server tests have 65 failures from missing `flock` and UID 0 permission behavior. | systemd and the declared Node service start; optional oomd lacks permission. Early overall failures also include a corrected harness error in inherited cgroup inspection. |
| Compatibility changes | Add `util-linux`; execute the payload as UID/GID 1000. | Add `util-linux`, CI account and `nix-ld`; disable optional oomd rather than adding SYS_ADMIN. |
| Full local and hosted payload | All seven existing CI stages pass. | All seven existing CI stages pass. |
| Tests on each placement | 1,819 server tests and 1,350 browser tests pass; four existing skips. | Same counts and unchanged coverage thresholds. |
| Host-enforced resource checks | Four CPU-equivalents, memory high 12 GiB, hard memory 16 GiB and 2,048 PIDs in the newer attempts and hosted job. | Same bounds, verified at the systemd scope ancestor. |
| Controlled local SIGTERM cleanup | Container and copied workspace removed. | Container and copied workspace removed. |
| Actual upstream injected Node probe | Node 24.19.0 starts. | Node starts after the compatible NixOS guest boots. |
| Exact NixOS runner injected Node probe | Fails with exit 127 without the host closure. | Same failure. |
| Independently produced image identity | Local and hosted image digests match. | Runtime configuration, history and 98 of 99 layer hashes match, but the final filesystem layer and image digest differ. Cause unknown. |

The Arion test uses its Nix evaluation, generated Compose configuration and full-system image with Podman directly. It does not test the Arion CLI or Docker Compose client. The injected Node probes execute real runner binaries, but do not represent complete registered-runner jobs. Hosted checkout and upload actions execute outside the containers.

The original Yeradon image is about 1.07 GB unpacked. The compatibility overlay is about 2.17 GB because it repeats some base paths; this is a prototype cost, not a general cost of package-only images. The compatible Arion image is about 0.92 GB. The single hosted jobs took 15 minutes 29 seconds and 12 minutes 31 seconds respectively. These observations are not benchmarks; cache state, archive format and overlay construction differ.

Opinion: prefer a package-only image for the current Node checks, which do not need guest systemd services. It avoids additional boot and cgroup integration. The costs are image maintenance and a container runtime. It does not provide a private kernel or solve the native injected-runtime link. Arion is a working alternative on the two tested placements when guest Service behavior is part of the test. Build once and transfer the resulting artifact before claiming byte-identical Arion images across placements.

The [prototype report](../../prototypes/nix-ci-routes/README.md) contains pinned inputs, precise receipts, compatibility changes and test limits. Production ownership and admission remain unchanged. No image was published to a registry, no host store/daemon was mounted, and no live Forgerie Service restarted.

## UNZEN package-only candidate preflight

The later preflight ran on physical UNZEN. Two temporary units copied selected restrictions from the live runner Service. User and mount namespace creation both failed with `Operation not permitted`. The existing runner stayed ready and idle with the same listener. No image payload ran and no registered job tested the candidate.

These results block the proposed direct Podman execution under the current Service policy. The [preflight report](../../prototypes/unzen-package-candidate/README.md) contains the exact restrictions, commands, scope limits and cleanup receipt. Installing a runtime alone does not remove the namespace restriction. A further container attempt needs a separately approved execution design.

## Confidence and open questions

Verified from primary sources: the image builders, concrete CI image recipe/workflow, full-system Arion example, NixOS VM test framework and GitHub integration mechanisms exist. Verified by execution: the adapted Forgerie payload works locally and on hosted Ubuntu, with the limits above.

Not verified: these container runtimes inside UNZEN's restricted production Service; whole-job JavaScript-action containers on UNZEN; Arion CLI/Compose integration; hosted cancellation or power-loss recovery; the cause of Arion's streamed-image digest mismatch; overall adoption scale. No disposable VM was tested. This work does not establish production readiness.
