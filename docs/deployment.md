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
| `forgerie doctor` | Report Node, config, runtime versions, and unit status. |
| `forgerie version` | Read local installed and running versions. |
| `forgerie --version` | Print the installed package version only. |

The names are `forgerie-web.service` and `forgerie-sessiond.service`. For a source checkout without a linked CLI, run `node dist/cli.js` with the same command.

## Update an existing checkout

A sessiond restart pauses active agents. At startup, sessiond scans the session catalog and inspects saved Durable tasks, submissions, and active workflows. It reopens unfinished work without a browser connection or another prompt. Completed and explicitly stopped runs do not restart. Archived and read-only sessions stay idle. Background children can still resume after the parent run was stopped. Workflows waiting for a user decision remain waiting.

Recovery opens at most four sessions at once. Discovery uses Durable's public storage API under the execution ownership lock. It does not parse full transcripts or import legacy sessions. The child live index is not the recovery authority. Unfinished child-run records also trigger reopening to repair accounting when a completion was already saved in Durable. Discovery adds disk reads, and recovered runtimes use memory. Interrupted tools still follow their replay policy; external commands are not guaranteed to survive or repeat safely.

Read the sessiond journal for `durable session startup recovery finished`, which lists resumed sessions and per-session failures. A missing journal leaves a legacy session idle. Corrupt or locked journals produce failures without blocking recovery of other sessions. Recovery stops opening sessions when shutdown starts.

Dependency replacement can affect code loaded by active agents. Confirm that the operator approves an idle deployment window before installing, building, or restarting the deployed checkout.

```bash
nix shell nixpkgs#nodejs_24 -c npm ci
nix shell nixpkgs#nodejs_24 -c npm run build
systemctl --user restart forgerie-sessiond.service forgerie-web.service
systemctl --user status forgerie-sessiond.service forgerie-web.service
curl --fail http://127.0.0.1:8504/api/pi-web/runtime
```

Run these commands from the deployed checkout, not from another worktree. Verify that the returned daemon profile is the intended profile. Confirm that the browser loads the new UI. Built entrypoints resolve the compiled browser app; the units do not run TypeScript source.

An isolated worktree build verifies source without replacing deployed `dist/` or dependencies. Landing that source is not deployment. The fork cleanup deliberately leaves deployment pending when agents are active.

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

Keep the previous verified commit and build until the new instance works. Rollback needs another approved idle window: restore the previous source, install its lockfile, rebuild, and restart both units. Do not remove profiles or runtime data as part of rollback.
