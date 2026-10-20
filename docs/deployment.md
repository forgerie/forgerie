# Local deployment

Forgerie runs from a checkout with separate web and session-daemon processes. The existing zao systemd user units run `node dist/server/index.js` and `node dist/server/sessiond.js`. The Tailscale proxy is a separate unit.

The server deployment target is Linux. Native Windows server installations are unsupported, and npm rejects installation on `win32`. Windows browsers can still connect to a Linux server. WSL2 has not been verified as a deployment target. Excluding Windows from package metadata does not establish support for other operating systems.

The daemon requires `flock` from util-linux for exclusive ownership of its Durable databases. Keep that kernel-lock guarantee and owner-only credential file permissions. Do not bypass them to run on an unsupported host.

The CLI controls existing Linux units. It never writes unit files or installs a service manager.

| Command | Action |
| --- | --- |
| `forgerie start` | Start sessiond, then web. |
| `forgerie stop` | Stop web, then sessiond. |
| `forgerie restart` | Restart the existing web and sessiond units. |
| `forgerie status` | Read both units' status. |
| `forgerie logs` | Follow both units' journals. |
| `forgerie deploy record BUILT_DIST EXPECTED_SHA` | Record an operator-verified isolated build. |
| `forgerie deploy BUILT_DIST DEPLOYED_DIST EXPECTED_SHA` | Publish that build immediately and restart both units. |
| `forgerie doctor` | Report Node, config, runtime versions, and unit status. |
| `forgerie version` | Read local installed and running versions. |
| `forgerie --version` | Print the installed package version only. |

The names are `forgerie-web.service` and `forgerie-sessiond.service`. For a source checkout without a linked CLI, run `node dist/cli.js` with the same command.

## Update an existing checkout

A sessiond restart pauses active agents. At startup, sessiond scans the session catalog and inspects saved Durable tasks, submissions, and active workflows. It reopens unfinished work without a browser connection or another prompt. Completed and explicitly stopped runs do not restart. Archived and read-only sessions stay idle. Stopping only the parent turn leaves background children resumable. A workflow's **Stop the run** cancels those too. Workflows waiting for a user decision remain waiting.

Recovery opens at most four sessions at once. Discovery uses Durable's public storage API under the execution ownership lock. It does not parse full transcripts or import legacy sessions. The child live index is not the recovery authority. Unfinished child-run records also trigger reopening to repair accounting when a completion was already saved in Durable. Discovery adds disk reads, and recovered runtimes use memory. Interrupted tools still follow their replay policy; external commands are not guaranteed to survive or repeat safely.

Read the sessiond journal for `durable session startup recovery finished`, which lists resumed sessions and per-session failures. A missing journal leaves a legacy session idle. Corrupt or locked journals produce failures without blocking recovery of other sessions. Recovery stops opening sessions when shutdown starts.

Active Durable sessions do not block deployment or restarts. Build and install dependencies in an isolated checkout so running agents keep their loaded code. Publish the verified build and restart both units without waiting for other sessions to become idle.

### Publish a verified isolated build now

Obtain approval to stop both units before publication. Active sessions pause during the restart; they do not require an idle window. The publisher never builds, installs dependencies, changes source, or removes a workspace.

Use a clean isolated checkout at the commit you intend to deploy. Run dependency installation, build, and verification there, not in the running checkout. Land that same commit in the deployed checkout before publication. For a direct CLI invocation, keep the isolated checkout and its dependencies until publication finishes. The staged launcher below can capture them before removal.

```bash
# In the isolated checkout, with Node 24:
npm ci
npm run build
npm run verify

BUILD=/absolute/path/to/verified-worktree
DEPLOYED=/absolute/path/to/deployed-checkout
SHA="$(git -C "$BUILD" rev-parse HEAD)"
NODE="$(command -v node)"

# Attest only after the checks and build above have passed.
"$NODE" "$BUILD/dist/cli.js" deploy record "$BUILD/dist" "$SHA"

# Run independently of the units being stopped. Do not add an idle wait.
UNIT="forgerie-publish-$(date +%s)"
systemd-run --user --collect --wait --unit="$UNIT" --setenv="PATH=$PATH" --setenv="HOME=$HOME" -- \
  "$NODE" "$BUILD/dist/cli.js" deploy "$BUILD/dist" "$DEPLOYED/dist" "$SHA"
journalctl --user -u "$UNIT" --no-pager
```

If the build is already verified, start at `BUILD=...`; do not repeat the checks merely to publish it. If `forgerie` is linked to this build, it accepts the same `deploy` arguments. The CLI ships in the package; the repository helper is not required.

**An independent launcher is required when calling from Forgerie or any process inside either target unit's cgroup.** Use `systemd-run --user` as above, not `nohup`, a background shell, or a child of sessiond. The publisher does not detach itself. Stopping sessiond can end the calling shell's wait, but the transient publisher continues. Read its journal from a new connection. A separate operator terminal outside those cgroups can run the CLI directly.

`deploy record` writes `dist/.forgerie-verified.json` with the expected full 40-character commit SHA, build-content digest, and dependency-lockfile digest. This is an explicit operator attestation that this build passed checks, not proof that the command ran those checks. It refuses to replace an existing receipt. A clean rebuild removes the old receipt; verify and record the rebuilt output again. Do not record old output against a new commit.

Publication requires two different, non-overlapping, existing absolute build directories, each directly under its checkout root. Symlink build directories and symlink build contents are refused. Both checkout revisions must equal the explicit SHA. The isolated source checkout must be clean. Both lockfiles must match the receipt. The publisher validates the CLI, server entrypoints, browser manifest and entry asset, and rejects changed or unstamped output. It checks revisions again after any wait, after staging, and before the swap. Unrelated edits in the deployed checkout do not replace the verified source.

The publisher leaves `node_modules` unchanged. Matching lockfiles cannot prove that installed dependencies are correct. Confirm the deployed dependencies already satisfy that lockfile. If dependencies must change, plan and approve that separate update; do not copy an isolated checkout's dependencies over running agents. Dependency upgrades are not an atomic part of this operation.

Publication takes an exclusive per-checkout lock at `.forgerie/publish.lock`. A competing publisher fails rather than waiting. The publisher copies and validates the build under `.forgerie/deploy.*` before stopping anything. It stops both units, confirms they are stopped, swaps the directories on that filesystem, then starts both units. It retains the previous build at `.forgerie/deploy.*/previous` and prints that path. After a successful publication it keeps the newest two `previous` builds and removes the older `deploy.*` directories that hold only a `previous` build. It prints the removed paths. A cleanup failure prints a warning and does not roll back the new build. Do not run another deployment mechanism against the same checkout while it holds this lock.

Readiness requires both units to be active, `/build.json` to report the prepared browser entry, and `/api/pi-web/runtime` to report `components.web.available` and `components.sessiond.available` as `true`. An active unit alone does not prove the daemon socket is ready. The publisher retries these checks within the existing readiness budget. The default readiness budget is 60 seconds; `--readiness-seconds N` accepts 0–600. This does not prove every Durable session has recovered.

The publisher reads `Result` and `NRestarts` of both units before the stop, after the stop and after readiness. It prints each change as `Warning: ...`, for example `sessiond stop timed out; SIGKILL` or `sessiond restarted 2× after start (NRestarts 0 → 2)`. A start resets `NRestarts` after an explicit stop, so a count after readiness is the number of automatic restarts since the start. These warnings do not cause a rollback and do not change the exit status. An automatic restart of sessiond can mean that the new daemon crashed, for example with `ELOCKED`; read its journal. See [durable session supervisor acceptance](testing.md#durable-session-supervisor-acceptance). Read the daemon journal, check `/api/pi-web/runtime` for the intended daemon profile, and confirm the browser loads the new UI. `FORGERIE_REDEPLOY_URL` overrides `http://127.0.0.1:8504`; pass it with `systemd-run --setenv=FORGERIE_REDEPLOY_URL=...` when needed.

If stopping, swapping, starting, or readiness fails, the publisher attempts to restore and restart the previous build and exits nonzero. Failed new builds remain at `.forgerie/deploy.*/failed` when a swap occurred. A rollback failure reports the recovery directory and exits nonzero. The publisher does not remove profiles or Durable data. It never removes a `deploy.*` directory that holds a `failed` build or any other entry; inspect and remove those manually. Two retained previous builds cost disk space.

### Stage an independent launch before removing the build worktree

The helper can queue the same verified CLI publisher independently, without
keeping its original worktree alive:

```bash
/bin/sh scripts/redeploy-when-idle.sh --launch --now "$BUILD/dist" "$DEPLOYED/dist" "$SHA"
```

This is the launcher for calls from Forgerie when the source worktree may go
away. It enters the Nix tool environment and passes both `PATH` and `HOME` to
`systemd-run --user`. It normalizes the explicit revision (a full SHA or Git
revision) to a full 40-character commit SHA. Direct CLI and ordinary helper
publication still require the full SHA as above.

Before queuing, the launcher checks that the original source is clean at that
revision and the deployed checkout is at the same revision. It makes an
independent Git clone at that SHA under the deployed checkout's
`.forgerie/publish.*` directory, then copies the verified build and installed
source dependencies there. Dependency links are dereferenced. The source can
be removed after the launcher returns. For a linked worktree, the launcher
prints the exact command, for example
`git -C /path/to/main-checkout worktree remove /path/to/verified-worktree`. This costs extra disk space and copy
time; missing dependencies or dependency-link cycles prevent launch. It never
installs dependencies or changes the deployed `node_modules`.

The staged CLI remains the only publication implementation. It validates the
unchanged receipt, source and target revisions, lockfiles, and build digest,
then uses the same exclusive lock, stop/swap/start, rollback, expected-build
check, and web/sessiond runtime readiness checks described above. The launcher
does not attest an unverified build or replace those checks.

The launcher prints the temporary unit name and retained directory. Read
`publish.log` and `result.json` there after the calling session disconnects.
The result changes from `queued` to `passed` or `failed`, with the publisher's
exit code, revision, unit name, and `warnings`, the publisher's warnings
array (empty when it saw no change). A launch failure records its exit code with
`phase: "launch"`. An uncatchable kill or host loss can leave `queued`; inspect
the retained log and unit journal instead of treating it as success.

After `result.json` records `passed`, the unit's last step removes the clone,
build, `node_modules` and `launcher.sh` from its `publish.*` directory. This
runs after the publisher exits, because the publisher runs from that clone.
Only `publish.log` and `result.json` remain; remove them when you no longer
need them. A `failed` or `queued` result keeps every staged file for
inspection; remove that directory manually after inspection. The main
publisher keeps its own previous builds as described above.

To request the existing explicit idle policy through this launcher:

```bash
FORGERIE_REDEPLOY_REVISION="$SHA" /bin/sh scripts/redeploy-when-idle.sh \
  --launch /absolute/path/to/own-workspace 60 "$BUILD/dist" "$DEPLOYED/dist"
```

### Optional explicit idle behavior

Only add an idle wait when the operator requests one:

```bash
# Use the same independent systemd-run launcher as above.
"$NODE" "$BUILD/dist/cli.js" deploy "$BUILD/dist" "$DEPLOYED/dist" "$SHA" \
  --when-idle /absolute/path/to/own-workspace --limit-minutes 60
```

Idle mode excludes the named workspace and defaults to 60 minutes (0–10080 accepted). Busy, unavailable, or malformed activity never permits a restart. Immediate publication never queries activity, even if the activity endpoint is unavailable.

The optional Nix-host helper retains its idle-first interface:

```bash
# Restart only, after an explicit idle wait:
/bin/sh scripts/redeploy-when-idle.sh /absolute/path/to/own-workspace 60

# Publish a recorded build after an explicit idle wait:
FORGERIE_REDEPLOY_REVISION="$SHA" /bin/sh scripts/redeploy-when-idle.sh \
  /absolute/path/to/own-workspace 60 "$BUILD/dist" "$DEPLOYED/dist"

# Publish immediately, with no activity query:
/bin/sh scripts/redeploy-when-idle.sh --now "$BUILD/dist" "$DEPLOYED/dist" "$SHA"
```

These helper calls also require an independent launcher when called from Forgerie. Run `/bin/sh /absolute/path/to/scripts/redeploy-when-idle.sh ...` through `systemd-run --user` so a minimal service PATH can reach its Nix bootstrap. Pass `FORGERIE_REDEPLOY_REVISION` with `--setenv` for idle publication; a missing SHA is an error. Publication delegates to the prepared build's CLI and requires its receipt. Restart-only calls keep their default 60-minute idle wait and fail closed. `--check` tests helper dependencies without restarting anything. The helper's restart-only log defaults to `~/.local/share/forgerie/redeploy-when-idle.log`; publication logs go to the launcher journal.

Landing source is not deployment. Publish the verified build even when other sessions are active.

## Runtime settings

Give both units the same global `PI_WEB_CONFIG`. Set an explicit `agent.dir` for Forgerie's profile. Keep the bind address on loopback and expose it through the trusted private-network proxy. Forgerie has no browser login barrier.

The web unit owns speech. Set `FORGERIE_WHISPER_STT_WORKER` to an executable absolute path, or put the worker on that unit's `PATH`. Set `FORGERIE_SPEECH_ALLOWED_HOSTS` for the browser origin served by the proxy. See [configuration](config.md).

Provider and global extension changes require a sessiond restart. A browser reload or session `/reload` does not replace the daemon's provider registry.

## Workspace service runtime

Declared services continue across web and sessiond restarts within the same host or container lifetime. Host or container shutdown can stop them. Forgerie reconnects to surviving instances. It does not automatically relaunch an instance after shutdown.

On systemd hosts, each instance has a separate transient user unit named `forgerie-services-<uuid>.service`. It must not share sessiond's cgroup. Without a user supervisor, the Unix launcher uses a detached Unix session and records its process birth and session identities. Shutdown checks include worker groups inside that session. Detached mode requires `ps` with `sess` and `stat` columns. Service commands must not detach into another session. Detached mode cannot track commands that escape this boundary. If Forgerie detects a systemd service boundary without independent user supervision, it refuses launch.

The first start provisions Process Compose 1.120.0 from pinned nixpkgs through Nix. A retained `runtime` link protects the package from garbage collection. Inventory mutations serialize across worktrees to prevent duplicate launches and port allocation races. Cold provisioning can delay other controls for up to ten minutes. Startup and shutdown confirmation each have a 30-second polling budget. A pending control request can extend that time.

State lives under `<data dir>/workspace-services/`. Socket paths cannot exceed 100 bytes. Use a short data directory.

A corrupt inventory or another owner's lock prevents startup. Forgerie refuses controls after it loses its inventory lock. It finishes admitted controls before it releases ownership during shutdown.

| Path | Purpose |
| --- | --- |
| `instances.json` | Stores instance identity, supervisor ownership, phase, and ports. |
| `runtime` | Retains the pinned Nix package. |
| `<worktree hash>/data/` | Retains service data outside the checkout. |
| `<worktree hash>/token` | Holds the private control token. |
| `<worktree hash>/launch.json` | Holds the private launch environment and command. Forgerie passes inherited environment values through this file. |
| `<worktree hash>/supervisor.log` | Holds the Process Compose diagnostic log. |
| `<worktree hash>/launcher.log` | Holds detached-launcher output. Systemd instances instead use their unit journal for runner output. |

A missing socket means unavailable until Forgerie proves that the recorded owner exited. An uncertain owner prevents another launch and checkout removal. For an unavailable instance, inspect its recorded unit or process and retained logs. Do not start another supervisor with a shell command. Do not edit the inventory to bypass an uncertain owner.

Prefixes must keep the working directory and run the supervisor in the foreground. Service commands must also remain in the foreground. Forgerie does not track external containers or processes that escape their supervisor. Repository code is not a sandbox. It inherits ordinary agent-visible environment values.

Named ports coordinate this inventory, not every program on the host. Another program can take a port between allocation and service startup. A retained port that is busy prevents a new launch. Service data and diagnostic logs remain after shutdown and worktree removal. This retention costs disk space and needs operator cleanup.

The inventory is local to one host and process namespace. Do not share it between machines. Browser controls, preview routing, and automatic startup remain follow-ups. See the [services API](session-worktrees.md#declared-workspace-services).

## Diagnostics and rollback

`/api/pi-web/runtime` reports process versions, capabilities, and the active daemon profile. `/api/pi-web/version` and `/api/pi-web/status` report local installed and running versions. They do not query npm or another release registry. Version comparisons do not identify source changes made without a package version change.

If the web process is unavailable, `forgerie version` also tries the daemon's health endpoint with a bounded wait. Read the unit journals for startup errors. If dictation is unavailable, check the web unit's worker path and speech host allowlist.

Keep the previous verified commit and build until the new instance works. A killed publisher or host crash can interrupt the two directory renames; this is not crash-atomic deployment. Inspect `.forgerie/deploy.*` and the unit journals before recovery. A dead publisher lock becomes eligible for recovery after 120 seconds. Do not remove a live publisher's lock. If `dist` is missing, stop both units from an independent terminal and restore the retained `previous` directory before starting them. Never overwrite the only retained build. Rollback does not require an idle window. Restore the previous source, install its lockfile and rebuild in an isolated checkout, then publish the build and restart both units. Do not remove profiles or runtime data as part of rollback.

## Scheduled triggers with no login

On hosts outside NixOS that run sessiond as a systemd user unit, enable linger for its user so the unit can run with nobody logged in:

```bash
sudo loginctl enable-linger <user>
loginctl show-user <user> -p Linger
```

Replace `<user>` with the account that owns `forgerie-sessiond.service`. This keeps that account's user manager running after logout and starts it at boot. It does not enable the service unit itself or keep the machine awake. Suspend can delay a scheduled workflow until wake; the trigger's grace window decides whether it runs late or is recorded as missed. See [scheduled workflows](triggers.md).
