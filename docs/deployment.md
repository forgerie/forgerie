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

A sessiond restart stops active agents. Dependency replacement can also affect code loaded by those agents. Confirm that the operator approves an idle deployment window before installing, building, or restarting the deployed checkout.

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

## Diagnostics and rollback

`/api/pi-web/runtime` reports process versions, capabilities, and the active daemon profile. `/api/pi-web/version` and `/api/pi-web/status` report local installed and running versions. They do not query npm or another release registry. Version comparisons do not identify source changes made without a package version change.

If the web process is unavailable, `forgerie version` also tries the daemon's health endpoint with a bounded wait. Read the unit journals for startup errors. If dictation is unavailable, check the web unit's worker path and speech host allowlist.

Keep the previous verified commit and build until the new instance works. Rollback needs another approved idle window: restore the previous source, install its lockfile, rebuild, and restart both units. Do not remove profiles or runtime data as part of rollback.
