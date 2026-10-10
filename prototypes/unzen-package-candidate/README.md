# Package-only candidate on UNZEN

The package-only candidate cannot proceed through the namespace preflight under the current Service restrictions. No image payload ran on UNZEN.

The user authorized this next experiment after the Yeradon and Arion comparison. The candidate is the previously tested Yeradon compatibility image, with digest `sha256:87a23bef7e8ecdf1170617111aed0cc599393054f88e822ab7f3602ab6e9549d`. Its earlier local and hosted results remain separate from this preflight.

## Executed scope

The preflight read the live `github-runner-forgerie.service` properties on physical UNZEN. It copied selected identity, filesystem, namespace, syscall, device and network restrictions into two temporary systemd units. Each unit ran one `unshare` command in `github-actions.slice`.

This is a constrained reproduction on UNZEN. It is not an actual registered runner job. It does not prove complete unit equivalence. The image was not transferred, loaded or executed.

| Check | Observed result |
| --- | --- |
| Current runner readiness before and after | Ready and idle, registration ID 20, zero startup restarts. |
| Current runner listener | PID 1913 before and after. |
| User namespace creation | Exit 1, `unshare: unshare failed: Operation not permitted`. |
| Mount namespace creation | Exit 1, same error. |
| Host Podman lookup | No executable in the SSH host's PATH. This is not a complete package inventory or a job-PATH test. |
| Temporary unit cleanup | Both units report `LoadState=not-found` and `ActiveState=inactive`. |
| Image payload | Not started. |

`evidence/unzen-preflight.json` records the live properties, exact commands, errors, readiness observations and cleanup. A zero remote-script exit means the preflight completed and produced its receipt. It does not mean the image passed.

## Integration limit

The live Service has `RestrictNamespaces=yes`, an empty capability set, `NoNewPrivileges=yes`, `ProtectControlGroups=yes` and `Delegate=no`. Its syscall filter also denies mount-related operations. These are established restrictions, not changes made by this experiment.

Rootless Podman needs namespace creation. The observed denials block the proposed direct command-level container execution. Installing Podman alone does not remove this limit. Changing the image's packages also does not change the Service restrictions. Other runtime requirements remain untested.

No runner policy, registration, production unit, Placement or Service state was changed by this experiment. No host Nix daemon was used by the probe. No image was published to a registry. No live Forgerie Service restarted. No additional runner or persistent manager was created.

## Recommendation

Opinion: retain native execution under the current policy. Its cost is less control over the surrounding OS environment. Container adoption needs a separate security and execution design before another payload attempt. Such a design must retain admission, resource accounting, network restrictions and cleanup. This report does not approve a broader namespace policy, privileged runtime socket or host-store mount.

The [earlier comparison](../nix-ci-routes/README.md) records the image's successful runs on ZAO and GitHub-hosted Ubuntu. Those results do not establish acceptance inside the UNZEN Service.

## Reproduction

`run-preflight.py` copies the bounded scripts to UNZEN with strict SSH host verification. `launch-preflight.sh` uses Python from the already deployed readiness-command closure, rather than requesting a Nix build. It removes the copied scripts on exit. `preflight.py` requires the native runner to be ready and idle, runs both probes, checks the same listener and removes its temporary units.

The driver uses fixed host and identity paths from this authorized experiment. Review these paths before reusing it elsewhere. The production Service remains unchanged. Do not reinterpret this preflight as a registered job or a complete image test.
