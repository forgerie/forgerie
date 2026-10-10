# Optional UNZEN Linux pilot

The pilot is not active. The optional manual workflow is prepared, but runner registration needs a dedicated GitHub App and a verified restricted runner group. The existing Linux, Windows, push and PR checks in `.github/workflows/ci.yml` stay unchanged.

## Admission

`.github/workflows/unzen-pilot.yml` accepts only manual dispatch on `main`. It requests group `unzen-forgerie-manual` and label `unzen-forgerie`. The repository variable `UNZEN_PILOT_ENABLED` must equal `true`; leave it unset until activation passes the gates below.

That variable, the job condition and the runner label are not security boundaries. Forgerie is public. GitHub must enforce all of these group properties:

| Property | Required value |
| --- | --- |
| Repository access | Selected repositories, only `forgerie/forgerie`. |
| Public repositories | Allowed, with workflow restrictions below. |
| Workflow restrictions | Enabled. |
| Selected workflows | Only `forgerie/forgerie/.github/workflows/unzen-pilot.yml@refs/heads/main`. |

Mountainous checks this policy through the GitHub API before every registration. It refuses registration on API failure, missing fields, additional repositories or a changed workflow/ref. If the GitHub account cannot enforce workflow restrictions, do not activate this public-repository runner.

## Runtime

Mountainous's disabled-by-default `mountainous.features.github-actions.enable` feature wraps upstream `services.github-runners`. Its dedicated GitHub App key belongs in a root-only UNZEN SOPS secret, never a workflow secret or the fleet secret file.

| Item | Pilot policy |
| --- | --- |
| Execution | One ephemeral native NixOS runner. |
| Tools | Node 24 and shell tools from the pinned NixOS closure. No `setup-node` download. |
| Scratch | Disk-backed private `/tmp` and `/var/tmp` bindings under `/srv/github-actions/tmp/forgerie`. |
| Workspaces | Disposable `/srv/github-actions/work/forgerie`, with root-owned parents. |
| Resources | Shared CI slice, CPU quota 400%, memory high 12 GiB, maximum 16 GiB, 2048 tasks. |
| Duration | Workflow timeout of 60 minutes. |
| Artifacts | GitHub coverage and environment report, retained seven days. |
| Store retention | The OS closure roots the tools. No extra cache service or per-commit Nix outputs. |
| Host daemon | Hidden from the job. Host Nix settings and non-CI builders stay unchanged. |

This pilot verifies npm tests and builds, not Nix source derivations. Blocking the host daemon prevents build work from escaping the CI slice. A Nix-native project needs a separate daemon resource policy before it joins.

The unit blocks LAN, tailnet and link-local IP ranges. It keeps loopback for HTTP contract tests. Native jobs therefore share the kernel and host loopback; this is not a sandbox for untrusted code or compromised dependencies.

The workflow runs the existing static, coverage, browser, build, npm 12 global-install smoke and package-content commands. `scripts/check-native-ci.mjs` records Node's store path, temporary filesystem and daemon-access result in `native-ci-report.json`. Checkout and upload actions are pinned to commits and use the runner's Node 24 runtime.

## Activation gates

1. Create and install a dedicated runner-only GitHub App on `forgerie`. Give it organization self-hosted runner read/write permission. Keep its private key out of chat.
2. Create the group with the exact admission policy above. Verify that a changed fork workflow cannot route to this group before registering UNZEN.
3. Encrypt the App key for only UNZEN and the operator. Enable the feature on UNZEN, supply upstream `githubApp.id`, `login` and `privateKeyFile`, then deploy a reviewed committed configuration non-destructively.
4. Verify registration and host services. Set `UNZEN_PILOT_ENABLED=true`, dispatch twice, and check logs, artifacts, scratch cleanup and store reuse.
5. Exercise failure, cancellation, retry, reboot and offline queuing before expanding the pilot or changing any required check.

The NixOS test uses the production unit policy with a deterministic workload. It checks identity, namespace hiding, writable disk scratch, loopback tests, slice membership, stopping and scratch cleanup. It does not prove GitHub registration, actual runner-worker cancellation or fork admission.

An offline runner queues enabled pilot jobs. It does not fall back automatically. Disable the pilot variable and manually dispatch the existing `CI` workflow for a hosted Linux/Windows run. No required merge check depends on UNZEN.
