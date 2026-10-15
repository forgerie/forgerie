# Configuration

Forgerie uses a global JSON file, environment overrides, and a Pi profile owned by the session daemon.

## Global file and paths

The default config file is `$XDG_CONFIG_HOME/forgerie/config.json`, or `~/.config/forgerie/config.json` when `XDG_CONFIG_HOME` is unset. `PI_WEB_CONFIG` selects another file. A missing file uses defaults.

```json
{
  "host": "127.0.0.1",
  "port": 8504,
  "agent": {
    "command": "pi",
    "dir": "~/.local/share/forgerie/agent"
  },
  "spawnSessions": true,
  "askUser": true,
  "codemode": true,
  "durableChildren": true,
  "childToolsDeny": []
}
```

Give the web process and session daemon the same `PI_WEB_CONFIG`. The default app-data directory is `~/.forgerie`. `PI_WEB_DATA_DIR` overrides it. Runtime data and source files are separate. Removing retired source does not remove session files, credentials, or `.pi-web/handoffs`.

The inherited `PI_WEB_*` names remain supported. They do not enable upstream installers, browser plugins, or remote-machine federation.

## Config fields

| Field | Purpose and default |
| --- | --- |
| `host`, `port` | Bind address and port. The web entrypoint defaults to `127.0.0.1:8504`. |
| `agent.command` | Pi-compatible companion executable. Defaults to `pi`. Use a bare executable name or an absolute path, not a shell command. |
| `azureDevops.azureCliCommand` | Azure CLI executable for server-only backlog and PR credentials. Defaults to `az`. Use a bare executable name or an absolute path, not a shell command. Restart sessiond to apply. |
| `agent.dir` | Profile containing `settings.json`, `auth.json`, `models.json`, extensions, and sessions. Defaults to `~/.pi/agent` for Pi-compatible commands. A different companion command requires an explicit profile. |
| `spawnSessions` | Enable the session-making tool. Defaults to `true`. |
| `askUser` | Enable the browser question tool. Defaults to `true`. Extension dialogs are separate and stay enabled. |
| `codemode` | Enable hosted scripts that call active tools. Defaults to `true`. Run-ending and session-making tools remain outside scripts. |
| `durableChildren` | Enable children stored inside the parent session's Durable storage. This is the only delegation tool. Defaults to `true`. See [child agents](child-agents.md). |
| `childToolsDeny` | Session tool names that Durable children must not share. Array of non-empty strings, default `[]`. For example `["web_search"]`. Missing and denied tools are reported to the child and parent. Does not remove child-native tools or sandbox their shell. Restart sessiond to apply. |
| `extensionDialogsTimeoutMs` | Default extension-dialog timeout, in milliseconds. Defaults to `300000`; `0` waits without a deadline. An extension's shorter timeout still wins. |
| `sessionTitleModel` | The `provider/model-id` that writes a new session's title from its first prompt, for example a small fast model. Unset: each session's own model writes its title. Set it in **Settings → Models → Session titles**. The session daemon reads it for each title, so a change applies to the next new session without a restart. If no signed-in provider offers the model, the session's own model writes the title, and the daemon logs `title_model_unavailable`. |
| `plugins` | Current browser-app plugin enablement and settings. See [plugins](plugins.md). |
| `pathAccess.allowedPaths` | External filesystem roots that file APIs can expose outside a workspace. Workspace access remains subject to path validation. |
| `uploads.defaultFolder` | Relative folder for saved uploads. Defaults to `.forgerie/uploads`. Absolute paths and parent traversal are rejected. |
| `maxUploadBytes` | Positive HTTP body limit, in bytes. Defaults to `67108864`. |

Settings writes desired configuration through `/api/config`. Retired `allowedHosts`, `shortcuts`, and `subsessions` fields no longer affect the runtime.

## Environment overrides

| Variable | Purpose |
| --- | --- |
| `PI_WEB_CONFIG` | Global config-file path. |
| `PI_WEB_DATA_DIR` | App-data directory. |
| `PI_WEB_HOST` | Web bind address. |
| `PI_WEB_PORT`, then `PORT` | Web port. |
| `PI_WEB_MAX_UPLOAD_BYTES` | HTTP body limit. |
| `PI_WEB_AGENT_COMMAND` | Companion executable. |
| `PI_WEB_AGENT_DIR` | Profile directory; takes precedence over file settings. |
| `PI_CODING_AGENT_DIR` | Pi-compatible profile override, used when `PI_WEB_AGENT_DIR` is unset. |
| `PI_WEB_AGENT_SESSION_DIR` | Session-directory override passed to the agent runtime. |
| `PI_CODING_AGENT_SESSION_DIR` | Pi-compatible session-directory override. |
| `PI_WEB_SPAWN_SESSIONS` | Session-making tool override. |
| `PI_WEB_ASK_USER` | Browser question-tool override. |
| `PI_WEB_CODEMODE` | Hosted-script tool override. |
| `PI_WEB_DURABLE_CHILDREN` | Durable child-agent tool override. |
| `PI_WEB_OFFLINE`, `PI_OFFLINE` | Disable background network work when set to any non-empty value. |
| `FORGERIE_WHISPER_STT_WORKER` | Absolute path to the dictation worker. |
| `DECISION_GATEWAY_API_KEY` | Sessiond-only Decision hints gateway key. A non-empty value overrides the Settings key file; Settings cannot replace or remove it. |
| `FORGERIE_SPEECH_ALLOWED_HOSTS` | Explicit comma-separated host allowlist for speech requests. |

Feature overrides enable a tool for `1` or case-insensitive `true`. Every other non-empty value disables it. An unset or empty value leaves the file setting in control.

## Desired and active profiles

Changing `agent.dir` or `agent.command` saves a desired profile. It does not move a running daemon's credentials or sessions. Profile-dependent reads and writes use the active profile reported by `/api/pi-web/runtime`.

Restart sessiond only in an approved idle window. Provider registrations freeze at daemon startup. `/reload` does not apply provider or global extension changes. See [deployment](deployment.md).

Configure credentials in the actual Pi profile, using Pi's own login flow or profile tools. The browser OAuth and API-key login routes are retired. Credentials already stored in `auth.json` remain usable.

## Azure CLI

Forgerie uses an existing `az login` sign-in when an organization has no PAT
file. Set `azureDevops.azureCliCommand` in the global config if the daemon's
PATH does not contain `az`. It is a file-level executable setting, not a token
or project setting. Settings saves preserve it. The default is `az`.

On NixOS, point it at a pinned Azure CLI store path, for example:

```json
{
  "azureDevops": {
    "azureCliCommand": "/nix/store/2f5gq8mb5ifwi4ir1l3qla08q2547l5z-python3.13-azure-cli-2.84.0/bin/az"
  }
}
```

Keep the other fields in your config. A Nix profile path that keeps the package
reachable prevents garbage collection of a pinned store path. If the binary
is removed, reads report an auth error; Forgerie never runs `nix run` at request
time. Restart sessiond only in an approved idle window after changing this
setting. See [Azure credentials and their security costs](azure-devops.md#connect-an-organization).

## Backlog settings

Open **Settings → Backlog** to set each project's Markdown and GitHub providers
and to manage standalone Azure DevOps **Sources**. The server saves settings in
`<data dir>/backlog-settings.json` (version 2, private mode `0600`, atomic writes).
The file contains `projects`, `sources`, an optional `githubLogin`, and a
file-wide revision sequence.

A per-project override wins over the canonical checkout's `.forgerie/config.json`
`backlog` section. It is not a field-by-field merge. **Use the repo file** removes
the override. With neither section, Forgerie reads Markdown from
`.forgerie/backlog/`. A saved override has an explicit, non-empty `providers`
list containing Markdown, GitHub, or both. Turning off a provider leaves files
and remote items unchanged.

The same project GitHub settings work in a saved override or in the repo file:

```json
{
  "backlog": {
    "providers": ["github"],
    "github": {
      "repo": "owner/repo",
      "authors": "trusted",
      "trustedBots": ["coderabbitai[bot]"]
    }
  }
}
```

| GitHub setting | Meaning |
| --- | --- |
| `backlog.github.repo` | Optional `owner/name`; otherwise use the GitHub origin remote. |
| `backlog.github.authors` | `"trusted"` (default) accepts owners, members, collaborators, authors with write access, Forgerie's own app, and listed trusted bots. `"all"` accepts everyone. |
| `backlog.github.trustedBots` | Optional list of at most 20 bot logins, unique case-insensitively. Each must match `^[A-Za-z0-9][A-Za-z0-9-]{0,38}\[bot\]$`. Matching logins is case-insensitive. |

With **Trusted authors only** on, listed bots' issue, PR, comment, and review
text reaches agents in `github_read`, GitHub backlog launches, and `github_watch`
notifications. Other outside authors stay hidden. Only bot accounts can have a
`[bot]` login, so a person cannot register the listed name. Trust still has a
cost: a listed bot can send external text to an agent. Add only bots you intend
to trust. This setting does not make their text instructions to follow. A new
bot policy uses a separate issue-list cache to avoid sharing trust decisions
between projects; the first read can make an extra GitHub request.

Azure sources contain an organization, Azure project, optional exact Area Path,
and optional registered destination project. They belong to no code repository
or project group. Saves reject overlapping Area Paths on the same board.
Without a destination, a manual launch needs a project selection. A registered
destination sets the default; a manual launch can choose any registered project.
A destination whose project was unregistered stays saved but resolves to
**Not routed**. No automation launches sessions in this change.

Revisions prevent an open Settings page from overwriting a newer save. A
conflict asks you to reload. The file-wide revision sequence also prevents an
old tab from overwriting an entry that was deleted and recreated. Changes apply
on the next read.

Settings lists a read error beside an inaccessible project folder or invalid
repo config. Other projects and the GitHub username stay editable. Stored
Forgerie overrides remain visible even when their project folder is missing.

On the first version-1 read, Forgerie backs up the file as
`backlog-settings.v1.json`, imports identical Azure board sections as one source
with no destination, removes Azure from project overrides, and atomically writes
version 2. Repository `backlog.azureDevops` and `azure-devops` provider settings
are retired with a warning; Forgerie never edits the repo file. See
[migration and downgrade](azure-devops.md#existing-settings-and-repository-files)
for import rules, overlapping migrated sources, and restoring the version-1
backup before running an older daemon.

An unreadable, malformed, invalid, or failed-to-migrate `backlog-settings.json`
stops all backlog reads and shows the same recovery message in Settings.
Forgerie never silently falls back to repo files or overwrites the damaged file.
Restore it from a valid backup, or remove it, then reload. Removing the file
discards all Forgerie backlog overrides, Azure sources, and the GitHub username;
only project-owned repo-file/default providers apply again.

The optional `githubLogin` is a username, not a credential. Without it, Mine
shows no GitHub issues and gives a Settings reminder. Everyone keeps the
trusted-author filter but lists issues regardless of assignment. The browser
remembers the scope in localStorage. See [Azure DevOps backlog](azure-devops.md)
for credentials, Area Paths, destinations, and the cost of Everyone reads.
Never put a token in Settings or repository config.

## Bundled CLIProxyAPI provider


Forgerie ships `@router-for-me/pi-cliproxyapi-provider` 1.4.21 and loads it by default. A separate Pi package install is not required. The provider joins the daemon's startup baseline and its commands load in every hosted session.

Keep connection settings in the active agent profile's `cliproxyapi.json`, or set `CLIPROXYAPI_BASE_URL` and `CLIPROXYAPI_API_KEY`. The default proxy address is `http://127.0.0.1:8317`. Forgerie does not install the proxy, create credentials, refresh account tokens, or spend banked resets.

Forgerie excludes other copies from Pi package settings, explicit extension paths, and auto-discovered extension folders before their factories run. It reports a warning for a different copy. Existing settings files and the terminal Pi profile stay unchanged. To share the bundled version with terminal Pi, use the package path named in the warning.

Restart the session daemon after a Forgerie upgrade changes the bundled provider. Changing connection settings also needs a restart because the shared provider baseline is fixed at daemon startup.

## Decision hints gateway key

Use **Settings → Plugins → Decision hints → Gateway key** to save, replace or
remove the key. Sessiond stores it in the active agent profile's
`decision-gateway.json` as `{ "apiKey": "…" }`, beside `auth.json` and
`cliproxyapi.json`. The file is mode `0600`, written through a private temporary
file and atomic rename. It is never part of the browser-readable config or plugin
settings. A desired `agent.dir` change does not redirect the write.

A non-empty `DECISION_GATEWAY_API_KEY` in sessiond's environment wins over the file.
Settings reports the source and refuses changes while this override is active.
File edits apply to the next gateway request without a restart. Service environment
changes still need a sessiond restart, since a running process cannot acquire them.
With neither source set, requests have no `Authorization` header. Status exposes
only presence and source, never the saved key or a fingerprint.

Agent bash runs as the same Unix user and can read profile credential files.
Use the scrubbed environment variable instead, and remove the key file, if agents
must not read this key. See [Decision hints security costs](decision-hints.md#gateway-key).

## Project settings and worktree hooks

The project file is `.forgerie/config.json`, relative to the checkout root. It is not a second global agent profile. Version 1 and files without a version retain their project-owned backlog, path access, and uploads behavior. Azure backlog sections are retired as described above. Version 2 adds declared workspace services.

See [session worktrees](session-worktrees.md) for creation, hooks, ownership, Land, Discard, and the services API. Existing hooks still come from the main checkout.

### Declared workspace services

Services require a managed worktree and manual approval. Forgerie uses pinned Process Compose 1.120.0 through Nix. The native Pi tool is `workspace_services`. The bundled `process` tool continues to manage separate ad-hoc commands.

A project declaration can name ports:

```json
{
  "version": 2,
  "env": "none",
  "services": {
    "file": "process-compose.yaml",
    "ports": ["web"]
  }
}
```

| Field | Contract |
| --- | --- |
| `services` | A relative Process Compose file path, or an object with `file` and optional `ports` and `preview`. |
| `services.file` | The file must exist inside the worktree. Parent traversal, absolute paths, and symlink escapes fail. |
| `services.ports` | Up to 16 unique lowercase names. Each name starts with a letter and contains letters, digits, or underscores. |
| `services.preview` | Names one declared port. Browser preview routing is not part of this delivery. |
| `env` | `"auto"`, `"none"`, or an argv prefix such as `["nix", "develop", "-c"]`. The default is `"auto"`. Shell strings fail validation. |

The environment prefix receives the pinned executable and its arguments. It must preserve the working directory. Forgerie adds these variables to service processes:

| Variable | Value |
| --- | --- |
| `FORGERIE_WORKTREE_PATH` | The absolute worktree path. |
| `FORGERIE_STATE_DIR` | A retained data directory outside the checkout. |
| `FORGERIE_PORT_WEB` | The port for `web`. Other declared names use the same uppercase form. |

For a Vite project, the Process Compose file can use the named port:

```yaml
version: "0.5"
processes:
  web:
    command: "npm run dev -- --host 127.0.0.1 --port ${FORGERIE_PORT_WEB}"
    readiness_probe:
      http_get:
        host: 127.0.0.1
        port: ${FORGERIE_PORT_WEB}
        path: /
      initial_delay_seconds: 0
      period_seconds: 1
```

Process Compose owns dependencies, probes, and restart policy. A process without a readiness probe is running, not proven ready. Successful one-shot processes count as complete for readiness waits. A static port in repository code can still collide with another worktree. Named ports work only when the commands and probes use their variables.

### Automatic environment selection

`env: "auto"` uses the first matching row. Each command must already be available in the launch environment.

| File in the worktree | Prefix |
| --- | --- |
| `devenv.nix` | `devenv shell --` |
| `flake.nix` | `nix develop -c` |
| `shell.nix` or `default.nix` | Refused. Use an explicit wrapper executable or `env: "none"`. |
| `.envrc` | `direnv exec .` |
| `mise.toml` or `.tool-versions` | `mise exec --` |
| No matching file | No prefix. |

Forgerie disables Process Compose's implicit `.env` loading. Repository commands can still load their own files. The prefix and service commands execute repository code. Pi must obtain user approval before it sets `approve=true`.

## Dictation

The web process owns Whisper. It resolves `forgerie-whisper-stt-worker` from its `PATH`, or uses the absolute `FORGERIE_WHISPER_STT_WORKER` override. The flake retains the pinned `whisper.cpp` worker and its `base.en` model.

A missing or unusable worker disables dictation, not the rest of Forgerie. Restart only the web process after changing its worker path or speech host policy. User-driven recording and transcription remain supported. Automatic Smart Turn execution and `/api/speech/check-turn` are retired. Speech status retains an inert `smartTurn: "unavailable"` field for older clients.

The separate `prototypes/voice-content` experiment owns its own speech stack. The production cleanup does not change it.
