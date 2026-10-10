# Disposable Nix CI route comparison

This is a test harness, not a production deployment. It compares a package-only Nix OCI image with Arion's full NixOS userspace under rootless Podman. Both run the same clean Forgerie revision, `09e3ef5e2ab8cf369a346915a6469a099a6cb616`.

## Scope and pins

| Input | Revision |
| --- | --- |
| Yeradon CI image | `6c839856889e5b99dbd52a09f50cb7c42cc06207` |
| Arion | `9b24cf65c72cb0e9616e437d55e1ac8e5c6bc715` |
| Common image Nixpkgs | `21a67dc470149f337cecafbe965d8d252a390518` |
| Accepted UNZEN runner Nixpkgs | `4975466d324710c576dc11ad614684e6bd8cad8e` |

Local execution uses ZAO's existing rootless Podman 5.8.1. It does not run inside UNZEN's restricted runner Service. No live Forgerie restart, UNZEN placement change, admission change, host Nix-daemon mount or registry publication occurs.

The disposable hosted comparison is [run 38089572231](https://github.com/forgerie/forgerie/actions/runs/38089572231), launched from a separate branch based on the frozen remote-main revision. It does not publish the shared main checkout's unrelated commits. Its jobs ran sequentially on `ubuntu-24.04` and kept checkout/artifact actions outside the test containers. Both jobs passed, including artifact upload. The downloaded receipts, coverage and full job logs were checked.

## Results

| Test | Observed result |
| --- | --- |
| Unmodified Yeradon image, container UID 0 | Dependency installation and static checks pass. Server coverage run fails with 65 failures: 61 report missing `flock`; four permission-denial tests incorrectly allow writes. |
| Minimal permission probe | UID 0 bypasses the denied directory; UID 1000 gets `EACCES`. Neither UID finds `flock` in the upstream image. |
| Yeradon plus `util-linux`, payload UID 1000 | All seven stages pass locally: installation, static checks, server coverage, browser verification, build, npm 12 package-install smoke test and package contents. Server tests: 1,819 passed, three existing skips. Browser tests: 1,350 passed, one existing skip. Coverage thresholds stay unchanged. Container and workspace cleanup pass. |
| Baseline Arion NixOS image | systemd boots and its declared service runs Node 24.19.0. `systemd-oomd` fails without `CAP_SYS_ADMIN`. Two startup receipts are invalid as overall verdicts because the harness incorrectly looked for CPU limits in `init.scope`, rather than its bounded ancestor. The receipts are retained, not hidden. |
| Upstream runner 2.337.0 Node executable | The actual Node 24.19.0 binary starts in Yeradon. It fails in the unbooted baseline Arion image because the FHS loader is absent. This tests executable compatibility, not a complete action or registered runner job. |
| Accepted NixOS runner's injected Node executable | Both baseline images fail to resolve `/__e/node24/bin/node`: it links to the host's exact Nix store closure, which is not mounted. Adding an unrelated Node to image `PATH` does not fix that link. |
| Compatible Arion image, payload UID 1000 | All seven stages pass locally. The server/browser test counts and all four coverage percentages match the compatible Yeradon run. Host cgroup limits are verified: four CPU-equivalents, memory high 12 GiB, memory max 16 GiB and 2,048 PIDs. Container and workspace cleanup pass. |
| Compatible injected-runtime probes | Upstream Node 24.19.0 starts in both compatible images. In the booted Arion guest, systemd has no failed units and `ci-probe.service` stays active. The exact NixOS runner Node symlink still fails with exit 127 in both images. |
| Controlled cancellation | SIGTERM to the driver during a real payload removes the container and copied workspace on both routes. Measured cleanup after the signal is 0.615 seconds for Yeradon and 0.766 seconds for Arion. This is not a GitHub cancellation or power-loss test. |
| Hosted jobs | Both pass all seven stages, with the same server/browser test counts, existing skips and coverage percentages as the local runs. UID 1001 on the hosted VM maps to guest UID 1000. Resource assertions and container/workspace cleanup pass on both routes. |
| Image identity across placements | Yeradon matches all 118 layers and its full image digest. Arion matches 98 of 99 layer hashes, runtime configuration and history, but its final filesystem layer and image digest differ. The cause was not established; an independently streamed Arion rebuild is not proven byte-identical. |

Selected receipts are under `evidence/`, including `hosted-comparison.json` and `local-lifecycle.json`. Full hosted receipts and coverage were downloaded before their seven-day artifact retention expires. The complete local attempt records, coverage artifacts and process logs remain under `/tmp/nix-ci-routes/` and the managed process log directory during execution.

## Compatibility changes tested

Yeradon remains the upstream image plus one package, `util-linux`, for `flock`. The application payload runs as UID/GID 1000. An init reaper handles shutdown. The compatibility overlay currently duplicates some base image paths, so its size is not an intrinsic cost comparison between the two routes.

Arion's compatible configuration adds the same explicit `flock` tool, a CI account and `nix-ld` for foreign binaries. It disables the optional guest `systemd-oomd` rather than adding `CAP_SYS_ADMIN`. The outer cgroup still limits memory. Nix is disabled inside this guest; neither guest mounts the host store or daemon.

Current attempts request four CPU-equivalents, memory high 12 GiB, memory max 16 GiB and 2,048 PIDs. The earlier successful Yeradon attempt recorded the hard limits only. The harness checks the actual host cgroup ancestor because systemd creates nested scopes whose files can omit inherited controller limits.

## Reproduction notes

`flake.nix` exports baseline and compatible image definitions. Arion builds a streaming archive executable plus the actual generated Compose configuration. `run-local.py` uses that configuration's image, environment, mount, tmpfs and stop-signal values with Podman directly. This exercises Arion's image/module output, not its Haskell CLI or a Docker Compose client.

`payload.mjs` executes the existing Forgerie CI commands against a clean checkout. `preflight.mjs` checks file permissions and `flock`. `probe-action-runtimes.py` tests actual upstream and NixOS runner executables with readonly external-runtime mounts and no network.

`run-hosted.py` installs Podman if needed and starts the disposable hosted user's systemd manager. Its guard rejects normal local execution. It is not a production setup script. The temporary workflow exists only on `proto/nix-ci-routes-hosted`; it is not a required check or a replacement for the accepted manual pilot.

## Measured costs and recommendation

| Single hosted run | Yeradon compatibility overlay | Arion compatible guest |
| --- | --- | --- |
| Nix build command | 154.131 seconds | 23.892 seconds |
| Test driver including image loading and cleanup | 765.197 seconds | 717.201 seconds |
| Complete job | 15 minutes 29 seconds | 12 minutes 31 seconds |
| Initial unpacked image size | 2,172,296,418 bytes | 919,256,929 bytes |
| Net VM disk increase including retained store/image cache | 6,705,012,736 bytes | 4,571,291,648 bytes |

These are one-run observations with cache and archive-format differences, not performance benchmarks. Arion's streaming archive is uncompressed here. The Yeradon overlay repeats some base paths, so its excess size is a prototype defect, not an intrinsic property of package-only images.

Opinion: use a package-only image for the existing Forgerie checks unless the tests need guest systemd services. This has fewer boot and cgroup integration requirements. The cost is maintaining an image recipe and a container runtime. It does not supply a private kernel or fix the native injected Node link. If systemd service tests are needed, Arion's full userspace is a working alternative on the two tested placements. Build one image once and transfer that artifact before making a stronger byte-identity claim.

## Delivery verification

The report delivery checkout uses newer local source, not the frozen comparison revision. Static checks pass. One parallel server run exceeded an existing 5-second child-agent test deadline. The focused file then passed all 18 tests. The full serialized server suite passed 1,893 tests with five skips. Browser verification passed 1,373 tests with one skip. No deadline or assertion changed. `evidence/report-verification.json` records these separate results.

## Limits

These results do not establish production readiness on UNZEN. Its Service currently has stricter user, namespace, network and daemon restrictions than this local harness. Testing a compatible runtime there needs separate validation without weakening those restrictions. The later [UNZEN preflight](../unzen-package-candidate/README.md) recorded namespace denials with selected live Service restrictions. No image payload ran.

A shared image still uses the host kernel and any mounted workspace filesystem. It does not replace the native bcachefs check. Times from these runs include cache state, source setup and different completed stages; they are not general performance benchmarks.
