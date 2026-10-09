# Forgerie configuration reference

Forgerie configuration covers the machine-local and project-local settings you usually need: the web/API bind address, trusted development-host settings, UI preferences, plugin enablement, file-explorer path access, manual upload defaults, upload limits, Pi-compatible agent profiles and companion CLIs, and session-daemon tools.

This file is the local configuration reference for Forgerie.

## Config files

Forgerie uses two config files:

- **Global Forgerie config:** `$PI_WEB_CONFIG`, or `$XDG_CONFIG_HOME/forgerie/config.json`, or `~/.config/forgerie/config.json`.
- **Project-local Forgerie config:** `<project>/.forgerie/config.json` for commit-able project settings.

Each Forgerie machine has its own config. When using Fleet/machine federation, Settings uses the selected machine for config that affects work running there: the Pi-compatible agent profile and companion CLI, session daemon tools, Forgerie plugin enablement, external path access, and upload defaults. Gateway/browser-only settings stay local to the gateway: keyboard shortcuts, remote machine registry/tokens, and gateway host/port/allowed-hosts.

Pi package settings are separate from Forgerie config. They live in Pi's package-manager settings on the target machine and are managed by Pi (`pi install`, `pi remove`, `pi update`) or **Settings → Pi packages**. In a federated setup, **Settings → Pi packages** targets the currently selected machine. The Forgerie `plugins` config key only enables or disables discovered Forgerie browser plugins on the machine whose config you are editing; it does not install, remove, or update Pi packages.

If you installed services with a custom config path, rerun `forgerie install --dev --config /path/to/config.json` after changing that path or after upgrading from a version that only applied the custom path to the web service. This regenerates service files so the web/API and session daemon use the same `PI_WEB_CONFIG`.

## Reverse-proxy deployment paths

The deployment path is not a Forgerie config-file key or environment setting. The published client is portable: one build works at `/` and at canonical trailing-slash prefixes such as `/ai/` or `/test/ai/`.

For a nested deployment, redirect the slashless prefix to the trailing-slash URL, strip the prefix before forwarding to Forgerie, and proxy authenticated HTTP and WebSocket traffic through the same location. Relative browser and PWA URLs then stay within that prefix. See the [reverse proxy installation guide](install.html#reverse-proxy-prefix) for a complete Nginx example.


## Local speech dictation runtime

Composer dictation is optional and gateway-local. The browser captures bounded mono float32 PCM and sends it to the Forgerie web/API process that served the page. That gateway performs Whisper transcription, then inserts final text into the current active-session or new-session draft. Audio is not proxied to the selected federated machine, even when the prompt text will later be sent to a remote machine.

Automatic turn detection is disabled. After speech starts, a pause does not end the recording. The user must stop dictation explicitly, or the 10-minute capture limit stops it.

The current runtime packages Whisper with Nix for `x86_64-linux` only:

```sh
nix build .#forgerie-whisper-stt-worker
nix profile install .#forgerie-whisper-stt-worker
```

The flake pins and realizes the `whisper.cpp` `ggml-base.en.bin` model. The Smart Turn worker remains available as a Nix output, but the web/API process does not resolve or start it while automatic turn detection is disabled. Wider installer integration and Docker or macOS model packaging are not available yet. A missing or unusable Whisper worker disables speech only; it does not stop the web UI or session daemon.

At web/API startup Forgerie resolves `forgerie-whisper-stt-worker` from the web process `PATH`. Resolution produces an absolute real path, and the worker starts without a shell. To bypass `PATH`, set an absolute executable override:

- `FORGERIE_WHISPER_STT_WORKER=/absolute/path/to/forgerie-whisper-stt-worker`

Relative paths, launcher strings, and shell snippets are ignored. `FORGERIE_SMART_TURN_WORKER` is ignored while automatic turn detection is disabled. Restart the web/API service or process after changing the Whisper override or the `PATH` visible to that service.

The web/API process warms Whisper after the HTTP listener starts. Readiness is reported by `GET /api/speech/status`:

- `manual-only`: Whisper is ready. Dictation transcribes when the user stops it explicitly.
- `warming`: Whisper is still starting.
- `unavailable`: Whisper is unavailable, so composer dictation is disabled.

Browser-classified speech POSTs also pass a gateway Host allowlist. `FORGERIE_SPEECH_ALLOWED_HOSTS` is a comma-separated list of allowed browser `Host` values for speech requests, such as `forgerie.example.ts.net:8504,forgerie.example.ts.net`. When unset, Forgerie allows the configured web/API host and localhost variants for the configured port. Set this when a reverse proxy or VPN hostname serves the browser, and restart the web/API service after changing it.

Speech uses fixed limits. Audio is 16 kHz mono float32 PCM, with a 10-minute maximum turn. Body uploads have a 60-second deadline. Transcription operations have a 120-second deadline. The gateway admits one active and one queued transcription, up to 12 transcriptions per minute. Whisper has a 60-second warmup deadline. Raw microphone audio stays in memory for the active bounded turn and 30-second retry buffer. Forgerie does not store raw audio as durable application data. Final text follows the normal draft/session behavior.

In active-session and new-session composers, tap the microphone once to start and again to transcribe. A held press listens until release. The **Toggle Speech Dictation** action has no default shortcut, but you can assign one in **Settings → Keyboard**. Permission denial, missing microphone hardware, model failures, status failures, and timeouts release the microphone and keep existing draft text unchanged.

`Ctrl+Alt+Enter` opens the voice composer for the selected session. The microphone is already listening when it opens. The shortcut works while you type in the composer and while a terminal has the keyboard. Use the left Alt key: Forgerie ignores Ctrl+Alt chords that carry AltGr, so that international text input is never read as a shortcut.

## Precedence and reloads

Machine-global runtime values are resolved as:

```text
defaults → global config file → environment overrides
```

Supported project-local settings are then applied for that project's workspaces. For upload defaults, `<project>/.forgerie/config.json` overrides the global value.

Environment overrides include `PI_WEB_HOST`, `PI_WEB_PORT` / `PORT`, `PI_WEB_ALLOWED_HOSTS`, `PI_WEB_MAX_UPLOAD_BYTES`, `PI_WEB_AGENT_COMMAND`, `PI_WEB_AGENT_DIR`, `PI_WEB_AGENT_SESSION_DIR`, `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` for Pi compatibility, `PI_WEB_SPAWN_SESSIONS`, `PI_WEB_SUBSESSIONS`, `PI_WEB_ASK_USER`, and `PI_WEB_CODEMODE`. Speech uses runtime-only web/API environment variables described in [Local speech dictation runtime](#local-speech-dictation-runtime).

Process restarts depend on the key:

- `host` / `port`: restart the gateway web/API service or process.
- `FORGERIE_WHISPER_STT_WORKER` / `FORGERIE_SPEECH_ALLOWED_HOSTS`: restart the gateway web/API service or process. The speech worker is web-owned, not session-daemon-owned. `FORGERIE_SMART_TURN_WORKER` is ignored while automatic turn detection is disabled.
- `maxUploadBytes`: restart both the web/API process and the session daemon on that machine.
- `agent.command` / `agent.dir` / `spawnSessions` / `subsessions` / `askUser` / `codemode` / `durableChildren` / `extensionDialogsTimeoutMs`: restart the session daemon on that machine.
- `pathAccess`: applies on the next request; existing file views may need a browser refresh.
- `uploads.defaultFolder`: applies to newly opened Files upload dialogs and new direct drag/drop batches after config/workspace refresh.
- `plugins`: reload the browser tab after changing Forgerie plugin enablement.
- Pi package install/remove/update: not a Forgerie config key; after a mutation, type `/reload` in each idle Forgerie session on the target machine to refresh ordinary Pi resources such as extensions, skills, prompt templates, themes, and context/system prompt files. Reload the browser page separately for Forgerie browser plugin changes. If a global Pi extension adds or removes a provider, or changes a provider's connection settings, manually restart `forgerie-sessiond.service`; `/reload` cannot change the startup provider baseline. A known provider refreshing only its own model list is applied without a restart. See [Pi extension provider baseline](#pi-extension-provider-baseline).
- `shortcuts`: saved settings apply in the browser after config refresh/save.

## Global config example

```json
{
  "host": "127.0.0.1",
  "port": 8504,
  "pathAccess": {
    "allowedPaths": ["~/SDKs", "/opt/reference"]
  },
  "uploads": {
    "defaultFolder": ".forgerie/uploads"
  },
  "maxUploadBytes": 67108864,
  "agent": {
    "command": "pi",
    "dir": "~/agent-profiles/research"
  },
  "spawnSessions": true,
  "subsessions": false,
  "askUser": true,
  "codemode": true,
  "extensionDialogsTimeoutMs": 300000,
  "plugins": {
    "relays": { "enabled": true },
    "updates": { "enabled": true },
    "info": { "enabled": false }
  },
  "shortcuts": {
    "core:actions.show": "ctrl+alt+p",
    "core:session.stop": null
  }
}
```

## Project-local config

Project-local config lives at `<project>/.forgerie/config.json`. Use it for settings that should follow a repository.

```json
{
  "version": 1,
  "pathAccess": {
    "allowedPaths": ["~/SDKs", "/opt/reference"]
  },
  "uploads": {
    "defaultFolder": "manual/uploads"
  },
  "backlog": {
    "dir": "work/items/"
  }
}
```

Project-local `pathAccess.allowedPaths` entries are merged after the global list and deduplicated. Paths must still be host-absolute or `~`-prefixed; relative roots are not supported.

Project-local `uploads.defaultFolder` overrides the global upload destination for workspaces in that project. Forgerie servers always include this workspace-effective value on the workspace responses used locally and through machine federation.

Forgerie also honors one optional project hook; see [Worktree pre-remove hook](#worktree-pre-remove-hook).

## Project backlog and launch API

The session daemon scans one backlog directory per registered project. The default is `.forgerie/backlog/`. Set `backlog.dir` in `.forgerie/config.json` to use another directory, such as `work/items/`. The path must be relative and stay inside the project. For Git projects, both config and items come from the canonical checkout identified by Git's common directory, including requests from linked worktrees. Config changes apply on the next backlog request.

Item content belongs in Git. If Git ignores the directory, the response includes an `ignored-directory` warning and still serves its items. Replace a wholesale `.forgerie/` ignore with:

```gitignore
.forgerie/*
!.forgerie/config.json
!.forgerie/backlog/
```

The scanner reads markdown files recursively. Frontmatter requires string `id` and `title`. Optional fields are `status`, `priority`, `labels`, `created`, `source`, and `blocked_by`. `labels` and `blocked_by` are string arrays. Unknown keys, including `claimed_by`, do not affect claims. The body retains its original whitespace and line endings. Invalid items and all copies of duplicate IDs produce warnings instead of launchable items. The scanner does not follow symbolic links. Limits are 256 KiB per item, 10,000 directory entries, and 16 directory levels.

Missing status means `To Do`. `done`, `completed`, `closed`, `cancelled`, and `canceled` are closed, without case sensitivity. An open item is blocked when a `blocked_by` ID names another open item in the same project. Missing or closed dependency IDs do not block. A claim overrides the displayed readiness, even when the file's status says closed. The file's status remains unchanged.

Every item carries a `provider`, which names where it comes from: `markdown`, the directory scanner described above, or `github`, described in [GitHub issues](#github-issues). Do not confuse it with the frontmatter `source` field, which records who captured a markdown item. Forgerie identifies an item by its canonical project, provider, and `id`, so the same `id` from two providers is two items with separate claims. Item routes accept `?provider=`. Omit it to select `markdown`. A provider that is not enabled on this host returns `404`, and a malformed name returns `400`. Release accepts any provider name, so a claim stays recoverable after its provider is disabled.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/backlog` | Return `{ items, warnings, generatedAt }` across registered projects. |
| `GET /api/backlog/:projectId/items/:itemId` | Return `{ item, body, initialPrompt }` for the new-session composer. This does not claim the item. |
| `POST /api/backlog/:projectId/items/:itemId/launch` | Confirm creation with `{ requestId, start }`. `start` uses the normal new-session choices, including `cwd`, `destination`, `modelSpec`, `thinkingLevel`, and `setupId`. |
| `POST /api/backlog/:projectId/items/:itemId/release` | Release with `{ claimId }`. A stale claim ID returns `409`. Release does not stop the session. |

Launch returns `{ session: { id, cwd }, claim, initialPrompt, reused }`. The composer sends its confirmed prompt through the existing session prompt endpoint. Launch alone does not run the agent. Use one stable `requestId` for retries of a confirmed launch. Repeating the same request returns the existing owner. Different choices or another claimant return `409`. Closed or blocked items cannot launch. The destination must belong to the same canonical project. These routes also exist under `/api/machines/local` and the federated machine prefix.

Claims live in `backlog-claims.json` in Forgerie's data directory, normally `~/.local/share/forgerie/`, or `$PI_WEB_DATA_DIR`. The daemon owns the store. A claim records the item and its provider, project, request, session, workspace, branch when available, and claim time. Claims written before `provider` existed load as `markdown` claims. Launch reserves the item before creating the session; a rejected creation releases the reservation. Archive and archived-session deletion release ownership, including bulk cleanup. Restore does not reclaim an item. No operation rewrites, moves, or mirrors a claim into the item file.

If the daemon restarts during creation, the reservation becomes `interrupted` and still blocks another launch. Inspect the worktree setup and any session first. Then release the exact `claimId` before retrying. Claims have no lease or expiry. File-only readers cannot see claims, and separate Forgerie hosts do not share claim ownership.

### GitHub issues

A project lists the open issues of its GitHub repo when its `.forgerie/config.json` turns the `github` provider on:

```json
{
  "backlog": {
    "providers": ["markdown", "github"],
    "github": { "repo": "korri-os/korri", "authors": "trusted" }
  }
}
```

`providers` lists the providers the project uses. Omitted, it is `["markdown"]`. `github.repo` is optional: without it, Forgerie reads the repo from the checkout's `origin` remote when that remote is on github.com. Forgerie reads only `origin`, never `upstream` or another remote. `github.authors` is `trusted` by default, which lists issues opened by the repo's owner, members, and collaborators. Set it to `all` to list issues from anyone. Each item's `id` is the issue number, its `path` is `owner/name#number`, and its `url` is the issue page. Pull requests are left out.

GitHub issue text is untrusted. On a public repo, anyone can open an issue, and a launched session receives the issue as its first prompt. Forgerie therefore hides outside contributors' issues by default and reports how many it hid with an `items-hidden` warning. The first prompt also quotes the title and body between markers and tells the agent to treat them as a description of a problem, not as instructions. These measures reduce the risk; they do not remove it. Read an issue before you launch it.

Forgerie only reads from GitHub. It never comments, assigns, labels, or closes an issue. A claim stays in Forgerie's store, the same as for markdown items.

Forgerie reuses a repo's issue list for one minute, then asks again with the list's ETag; GitHub does not count an unchanged answer against the rate limit. It sends one GitHub request at a time and reads at most 500 open issues and pull requests per repo. When GitHub is unreachable or rate limited, the list keeps the last good result and a `provider-unavailable` warning says how old it is. Each failure is a warning that names its fix: `provider-auth` when GitHub is not set up on this machine or no longer accepts its app, `provider-install` when the app may not read the project's repo, and `provider-unavailable` for anything else, such as no GitHub remote.

#### GitHub setup

Forgerie reads GitHub as its own GitHub App, not as a person. Nobody logs in, and nothing expires while the app exists.

Set it up from the backlog: press **Set up GitHub**, then **Create GitHub App** on the page GitHub opens. GitHub creates the app from Forgerie's manifest (public, no webhook; `Issues`, `Pull requests`, and `Contents` read and write; `Checks` and `Commit statuses` read-only) and returns you to Forgerie, which keeps the app's ID and private key. GitHub must be able to send your browser back to the page you started from, so start from the address you normally use. Then press **Install on GitHub** and choose the accounts and repos the app may read. Installing on an organization you do not own sends a request to its owners. The app must be public to install it on an organization that does not own it; with no webhook and no user login, being public gives nobody else access to anything.

Forgerie signs a 10-minute token with the private key, trades it for a 1-hour installation token for each repo, and renews that token 5 minutes before it expires. A repo where the app is not installed produces a `provider-install` warning with the install link; Forgerie checks again after a minute.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/github/app` | Return `not-configured`, or `configured` with the app's `slug`, `owner`, `url`, and `installUrl`. |
| `POST /api/github/app/setup` | Start setup with `{ origin }`, the page's own origin. Return `{ action, manifest }`: the browser posts `manifest` to `action`. The setup expires after one hour. |
| `POST /api/github/app/created` | Finish setup with the `{ code, state }` GitHub added to the return address. A `state` this machine did not issue, or one older than an hour, returns `400`. |
| `DELETE /api/github/app` | Forget the app on this machine. It stays on GitHub until its owner deletes it there. |

These routes also exist under `/api/machines/local` and the federated machine prefix. Each machine's daemon scans its own projects, so each machine creates its own app.

The app lives in `github-app.json` in Forgerie's data directory with owner-only permissions (`0600`). It holds the private key, which can do everything the app's permissions allow on every repo where the app is installed, including merging pull requests, until you delete the key on GitHub. Forgerie drops the client secret and webhook secret GitHub sends at setup, and no response contains the key or a token. If GitHub stops accepting the app because it was deleted or its key revoked, the backlog shows a `provider-auth` warning: remove the app in the backlog and set GitHub up again.

### Azure DevOps work items

Set `backlog.providers` to include `"azure-devops"`, and configure
`backlog.azureDevops` with `organization`, `project`, and an optional `areaPath`.
The provider lists work items assigned to the owner of an organization-scoped
PAT with Work Items: Read permission. The token lives outside Git in
`<data directory>/azure-devops/<organization>.pat`, with mode `0600`.

The first release reads descriptions, acceptance criteria, and reproduction
steps, and uses the existing session launch and claim flow. It does not write
to Azure or manage Azure Repos pull requests. See [Azure DevOps setup and
limits](azure-devops.md) before configuring a project.

## Worktree pre-remove hook

Before Forgerie deletes a workspace (a secondary Git worktree), it gives the repository one chance to tear down project-owned infrastructure tied to that worktree. To use the hook, provide an executable script at:

```text
.forgerie/hooks/worktree-pre-remove
```

relative to the workspace where the deletion command runs. Forgerie runs the deletion command from the project's main workspace when it exists, so commit the hook there and it follows the repository.

When the hook is present and executable, Forgerie dispatches the hook and the removal as one composed terminal command:

```sh
'<hook path>' '<worktree path>' && git worktree remove '<worktree path>'
```

Contract:

- **Arguments:** exactly one — the absolute path of the worktree being deleted.
- **Working directory:** the workspace the deletion command runs in, not the worktree being deleted.
- **Exit codes:** `0` lets the removal proceed; any non-zero exit blocks it. The `&&` chain is the fail-closed guarantee — a failing hook keeps the worktree on disk.
- **Absent hook:** a missing file, or a file without the executable bit (for example after a checkout that lost it), is treated as no hook; Forgerie then runs a plain `git worktree remove`.

The composed command is dispatched like any other workspace deletion — same `Delete workspace: <branch>` terminal title — so hook output and failures are visible in the terminal run. If Forgerie cannot probe the hook path because of an unexpected filesystem error, the deletion request fails before any workspace terminals are closed.

Example: a hook that stops and removes local dev containers that bind-mount the worktree, so deletion does not leave stale containers behind. The hook is an opaque extension point — the contract does not assume any specific tooling, so use whatever the repository standardizes on:

```sh
#!/bin/sh
# .forgerie/hooks/worktree-pre-remove
set -eu

worktree_path="$1"

# Stop/remove local dev containers bind-mounting "$worktree_path",
# release other per-worktree resources, etc.
# Exit non-zero to block the worktree removal.
```

## Configuration matrix

Rows with JSON key `—` are runtime-only environment variables, not config-file keys. `Global` means machine-global. In Settings, selected-machine-safe global keys (`pathAccess`, `uploads`, `maxUploadBytes`, `agent`, `spawnSessions`, `subsessions`, `askUser`, `codemode`, and `plugins`) are edited for the selected machine; gateway host/port/allowed-hosts, keyboard shortcuts, and machine registry/tokens stay local.

| Config | JSON key | Env var | Scope | Project-local behavior | Applies / restart |
| --- | --- | --- | --- | --- | --- |
| **Config-file keys** |  |  |  |  |  |
| Web/API bind host | `host` | `PI_WEB_HOST` | Global | Not supported locally | Restart web/API |
| Web/API port | `port` | `PI_WEB_PORT`, `PORT` | Global | Not supported locally | Restart web/API |
| Dev-server allowed hosts | `allowedHosts` | `PI_WEB_ALLOWED_HOSTS` | Global | Not supported locally | Restart dev web/UI |
| External filesystem roots | `pathAccess.allowedPaths` | — | Global + project | **Merges**: global roots first, then project roots; duplicates removed | Next file request; refresh existing views if needed |
| Manual file upload default folder | `uploads.defaultFolder` | — | Global + project | **Overrides**: project value wins for workspaces in that project; otherwise global/default applies | New Upload dialogs and direct drag/drop batches after config/workspace refresh |
| Upload/body limit | `maxUploadBytes` | `PI_WEB_MAX_UPLOAD_BYTES` | Global | Not supported locally | Restart web/API and session daemon on that machine |
| Companion CLI command | `agent.command` | `PI_WEB_AGENT_COMMAND` | Global/session daemon | Not supported locally | Restart session daemon on that machine; affects doctor/status/update checks |
| Agent profile state directory | `agent.dir` | `PI_WEB_AGENT_DIR` (`PI_CODING_AGENT_DIR` for Pi compatibility) | Global/session daemon | Not supported locally | Restart session daemon on that machine; affects auth, models, settings, sessions, Pi packages, and Pi-package-backed Forgerie plugins |
| Agent can spawn sessions | `spawnSessions` | `PI_WEB_SPAWN_SESSIONS` | Global/session daemon | Not supported locally | Restart session daemon on that machine |
| Tracked subsessions (beta) | `subsessions` | `PI_WEB_SUBSESSIONS` | Global/session daemon | Not supported locally; also requires `spawnSessions` | Restart session daemon on that machine |
| Agent can post question forms | `askUser` | `PI_WEB_ASK_USER` | Global/session daemon | Not supported locally | Restart session daemon on that machine |
| Agent can run tool scripts | `codemode` | `PI_WEB_CODEMODE` | Global/session daemon | Not supported locally | Restart session daemon on that machine |
| Durable child agents (opt-in) | `durableChildren` | `PI_WEB_DURABLE_CHILDREN` | Global/session daemon; config file only, not in Settings | Not supported locally | Restart session daemon on that machine; see [child agents](child-agents.md) |
| Extension dialog auto-cancel timeout | `extensionDialogsTimeoutMs` | — | Global/session daemon | Not supported locally | Restart session daemon on that machine |
| Plugin enablement/settings | `plugins.<id>.enabled`, `plugins.<id>.settings` | — | Global | Not core local config; plugins may read their own project files | Reload browser tab |
| Keyboard shortcuts | `shortcuts.<actionId>` | — | Global | Not supported locally | Applies after settings save/config refresh |
| Project config version | `version` | — | Project | Project-local only; must be `1` when present | Next project-config read |
| **Runtime-only environment variables** |  |  |  |  |  |
| Speech Smart Turn worker | — | `FORGERIE_SMART_TURN_WORKER` | Gateway web/API env | Not supported locally | Ignored while automatic turn detection is disabled |
| Speech Whisper worker | — | `FORGERIE_WHISPER_STT_WORKER` | Gateway web/API env | Not supported locally | Restart web/API; absolute executable override only; otherwise resolved from `PATH` |
| Speech browser Host allowlist | — | `FORGERIE_SPEECH_ALLOWED_HOSTS` | Gateway web/API env | Not supported locally | Restart web/API |
| Global config file path | — | `PI_WEB_CONFIG` (`XDG_CONFIG_HOME` affects the default path) | Process/env | Selects the global config file; not a project config | Restart services/processes after changing env |
| Managed data directory | — | `PI_WEB_DATA_DIR` | Process/env | Not supported locally | Restart web/API and session daemon |
| Session daemon socket | — | `PI_WEB_SESSIOND_SOCKET` | Web/API + session daemon env | Not supported locally | Restart daemon and web/API; both must match |
| Session daemon TCP port | — | `PI_WEB_SESSIOND_PORT` | Session daemon env | Not supported locally | Restart session daemon; set `PI_WEB_SESSIOND_URL` for web/API too |
| Session daemon TCP host | — | `PI_WEB_SESSIOND_HOST` | Session daemon env | Not supported locally | Restart session daemon |
| Web-to-daemon URL | — | `PI_WEB_SESSIOND_URL` | Web/API env | Not supported locally | Restart web/API |
| Projects storage file | — | `PI_WEB_PROJECTS_FILE` | Web/API + session daemon env | Not supported locally | Restart services; advanced state override |
| Remote machines storage file | — | `PI_WEB_MACHINES_FILE` | Web/API env | Not supported locally | Restart web/API; advanced state override |
| Agent profile session storage directory | — | `PI_WEB_AGENT_SESSION_DIR` (`PI_CODING_AGENT_SESSION_DIR` for Pi compatibility) | Session daemon env | Not supported locally | Restart session daemon; env-only session storage override |
| Agent profile state directory | — | `PI_WEB_AGENT_DIR` (`PI_CODING_AGENT_DIR` for Pi compatibility) | Web/API + session daemon env | Not supported locally | Restart services |
| Skip update checks | — | `PI_WEB_SKIP_VERSION_CHECK`, `PI_WEB_OFFLINE`, `PI_SKIP_VERSION_CHECK`, `PI_OFFLINE` | Web/API env | Not supported locally | Restart web/API after env changes |
| Offline mode | — | `PI_WEB_OFFLINE`, `PI_OFFLINE` | Web/API + session daemon env | Not supported locally | Restart session daemon and web/API after env changes; also disables the [background model catalog refresh](#background-model-catalog-refresh) |

## Key details

### Managed data directory

`PI_WEB_DATA_DIR` sets the root for Forgerie-managed runtime state and defaults to `~/.pi-web`. Unless a more specific path override is configured, Forgerie stores its project and machine registries, locally discovered plugins, default session-daemon socket, and session archives beneath this root.

Each data directory is independent: after pointing Forgerie at a new root, it starts there with empty registries and no session archives. To carry session archives over, stop Forgerie, then copy `archived-sessions.json` and the `archived-sessions/` directory from the old data directory into the new one before starting it again.

This setting does not change the Forgerie config file selected by `PI_WEB_CONFIG` or Pi-owned state such as the active session files selected by `PI_CODING_AGENT_SESSION_DIR`.

### Agent process environment

Agent shells, terminals, and spawned sessions do not inherit the session daemon's own configuration. When the daemon starts, it removes its `PI_WEB_*` configuration keys, `NODE_ENV`, `PORT`, and `PI_CODING_AGENT_SESSION_DIR` from the environment agent processes see, so development commands behave normally inside sessions — for example, `npm install` is not affected by a production `NODE_ENV` meant for the daemon, and a second Forgerie instance started from a session does not pick up the live daemon's data directory or socket. `PI_CODING_AGENT_DIR` and ordinary variables (`PATH`, `HOME`, proxy settings, and the like) remain visible. The daemon itself keeps using the values it captured at startup.

### External path access

`pathAccess.allowedPaths` grants Forgerie's file explorer and absolute `@` path completions access to specific filesystem roots outside the current workspace.

By default, workspace-relative file reads stay inside the workspace and absolute paths are denied. Add only roots you trust Forgerie to list and read through the browser UI.

Accepted root forms:

- Unix absolute paths: `/opt/reference`
- Home-relative paths: `~/SDKs`
- Windows absolute paths on Windows hosts: `C:\Users\dev\SDKs`

When an absolute request is served, Forgerie expands `~`, canonicalizes the configured roots with `realpath`, requires roots to be existing directories, and rejects symlink escapes outside the allowed roots.

In **Settings → General**, external filesystem roots are saved on the selected machine. Gateway host, port, and allowed-hosts fields stay on the gateway config.

This is not a sandbox for the underlying Pi Coding Agent or your OS user. It only controls Forgerie UI/API file exposure outside a workspace.

### Manual upload defaults

The Files panel can upload one or more files in two ways:

- Drop files onto the Files panel to upload immediately to the workspace-effective default folder.
- Use the toolbar **Upload** button to open the review dialog, edit the destination, and opt into upload options.

`uploads.defaultFolder` sets the workspace-effective default destination. The built-in default is `.forgerie/uploads`; a global config value applies to every project unless `<project>/.forgerie/config.json` sets a project-local override.

```json
{
  "uploads": {
    "defaultFolder": "manual/uploads"
  }
}
```

The value must be a non-empty workspace-relative folder. Forgerie normalizes repeated separators and backslashes to `/`, and rejects absolute paths or `..` traversal. In the upload dialog only, clearing the destination field uploads that batch to the workspace root.

Manual uploads use the workspace file-write path: paths stay workspace-relative, parent folder creation is enabled by default, and overwrite is disabled by default. Direct drag/drop always keeps `overwrite` off; the review dialog lets you explicitly enable overwrite when needed. Browser-owned XHR progress is shown per batch/file, conflicts and errors stay visible in the upload progress UI, and the final file-write response is the source of truth.

For machine federation, Settings saves the global upload default on the selected machine. Remote Forgerie servers always return `workspace.effectiveConfig.uploads.defaultFolder` on the workspace-list response, and the Files panel uses it as the default upload destination.

The per-request size limit is still controlled by `maxUploadBytes` / `PI_WEB_MAX_UPLOAD_BYTES` on the machine serving the upload.

### Pi-compatible agent profile and companion CLI

`agent.command` selects the Pi-compatible companion CLI used by `forgerie doctor` and, when it can be generated safely, package-managed update commands. It defaults to `pi`. This setting does **not** replace the embedded runtime: every session continues to use Forgerie's bundled Pi SDK.

`agent.dir` selects the Pi-compatible state profile used for auth providers, models, settings, sessions, Pi packages, and Pi-package-backed Forgerie plugin discovery. It defaults to `~/.pi/agent` only for a canonical Pi companion command. The directory must use the data layout supported by the bundled Pi SDK; Forgerie does not load or convert incompatible fork formats, migrate profile data, or repartition Forgerie-managed archives when the profile changes.

```json
{
  "agent": {
    "command": "pi-lab",
    "dir": "/opt/pi-profiles/lab"
  }
}
```

An alternate command always requires an explicit state directory. The command must be a safe bare executable name such as `pi-lab` or a host-absolute executable path such as `/opt/pi/bin/pi`; relative paths, shell expressions, and launcher strings are rejected. The state directory must be host-absolute or start with `~`. In a federated save, the gateway transports Unix and Windows absolute paths without reinterpreting them, and the target machine validates and returns the persisted profile.

Environment variables take precedence over the config file. `PI_WEB_AGENT_COMMAND` selects the companion CLI, `PI_WEB_AGENT_DIR` sets the profile state directory, and `PI_WEB_AGENT_SESSION_DIR` overrides session storage separately from `agent.dir`. The legacy `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR` names apply only to a canonical Pi companion command; Forgerie never derives ambient environment-variable names from an arbitrary command. Use the explicit `PI_WEB_AGENT_*` names for alternate commands. `PI_WEB_AGENT_DIR` is an unconditional override, while a legacy `PI_CODING_AGENT_DIR` override stops applying when Settings selects an alternate command so the command and directory can transition together.

The session daemon resolves the persisted desired values plus its environment once at startup. That secret-free active profile stays fixed for the daemon lifetime. **Settings → Session daemon** saves command and directory together as desired configuration and shows whether the profile is active, needs a restart, or cannot be compared. Until the daemon restarts, sessions, Pi package operations, Pi-package-backed Forgerie plugin discovery, status/install detection, and update planning continue to use the daemon-owned active profile; a web/API restart recovers that same active profile instead of applying the newly saved values.

If the session daemon cannot report a valid active profile, profile-dependent Pi package and Forgerie plugin operations report unavailable instead of falling back to independently resolved config. A package-managed update command is shown only when Forgerie can preserve the active profile with a recognized, safe Pi companion CLI; otherwise the command is omitted. Restart the session daemon on the selected machine to establish the next active profile.

### Pi extension provider baseline

This policy applies to **Pi runtime extensions**, not Forgerie browser plugins. Pi extensions are runtime modules loaded by the session daemon and can call `pi.registerProvider(...)`; Forgerie plugins are browser-side UI modules and never run in the session daemon.

Forgerie shares one model runtime across all sessions. When the session daemon starts, before any project resources load, it initializes global Pi extensions from the active agent profile (`agent.dir`), including extensions supplied by globally configured Pi packages. Provider registrations made by synchronous or awaited asynchronous extension factories during this bootstrap join the shared baseline. Forgerie captures both config-form registrations (`pi.registerProvider("id", config)`) and native-provider registrations (`pi.registerProvider(provider)`), alongside Pi built-ins, environment credentials, and providers from the active agent directory's `models.json`.

After startup capture, a provider's connection settings are fixed for the daemon lifetime. Later attempts to add a provider, replace an existing provider's configuration, register a native provider, or unregister a provider are no-ops, regardless of source or provider ID. This includes project extensions attempting to add or replace a provider, lifecycle callbacks such as `session_start`, and `/reload`. Non-provider Pi extension features continue to load and reload normally.

#### Model list refresh for a known provider

One narrow update is applied after startup: a provider captured in the baseline may refresh **its own model list**. Extensions that fetch an updated catalog typically re-send their complete provider configuration, so Forgerie compares the incoming registration against the recorded baseline and applies it only when both hold:

- the provider ID is already in the startup baseline, and
- every field except the model list is unchanged — `name`, `baseUrl`, `apiKey`, `api`, `streamSimple`, `headers`, `authHeader`, `oauth`, and `refreshModels`.

Anything else stays a no-op, including a provider that was not in the baseline and a known provider whose credentials, base URL, or API surface differ from startup. Function-valued fields cannot be compared by value, so a registration that supplies a new `streamSimple`, `refreshModels`, or `oauth` implementation is treated as a change and ignored.

An applied refresh becomes the new comparison point, so a provider can refresh repeatedly. Re-sending an unchanged model list is a replay rather than an update and is ignored. Refreshed models are visible to sessions immediately; no restart and no network request is involved, because the extension has already produced the catalog.

Model lists are shared daemon-wide state. If extensions in two workspaces register different model lists for the same provider ID, the last registration wins. A model entry may also carry its own `baseUrl` and `headers`, which take precedence over the provider-level values for that model, so an accepted refresh can change where requests for those models are sent. Both are accepted trade-offs: a catalog is treated as a property of the provider rather than of the project, and Pi extensions are trusted daemon code.

#### Provider decisions in the daemon log

Ignored mutations are written to the session-daemon log once per operation and provider ID, so a replaying extension cannot flood the log. Applied model list refreshes are logged every time, with the resulting model count, because each one changes shared runtime state. Neither entry contains provider configuration or credentials, and Forgerie does not show a session warning or notification.

This prevents accidental provider, configuration, or credential contamination between projects; it is not a security boundary because Pi extensions remain trusted daemon code.

Configure providers before the daemon starts: use the active agent directory's `models.json`, or install the Pi extension globally in that agent profile. Project Pi extensions and project-level `models.json` files cannot add providers to Forgerie's shared baseline. After updating Forgerie—or after installing, removing, or updating a global Pi extension that registers providers—manually restart `forgerie-sessiond.service` (`systemctl --user restart forgerie-sessiond`). Restarting only the web/API service and running `/reload` do not rebuild the baseline.

### Background model catalog refresh

Forgerie shares one model runtime across all sessions, and provider model catalogs are refreshed over the network only on the session daemon's own background schedule. Requests never start a catalog fetch of their own, so a slow or unreachable provider cannot stall opening the model selector, starting a session, or the auth dialogs on its own account.

A refresh that is *already* in flight can still briefly delay starting or opening a session, because the shared runtime is read while that refresh is running. Forgerie says so while you wait: the session's activity line names the startup step it is on and adds `provider model lists are refreshing` when a background refresh is running at the same time. That note reports what is happening concurrently, not a proven cause.

The session daemon runs the refresh:

- **15 seconds after the daemon starts**, then **hourly**. Pi treats stored catalogs as fresh for four hours, so most hourly ticks make no network request at all; the shorter tick only makes sure a due refresh is not delayed to the next tick.
- **Immediately after a provider login or logout**, bypassing that freshness window, because the cached catalog is known to be wrong.

Each run is bounded: it is aborted after **60 seconds**, and a run that times out or cannot reach a provider earns **one retry after five minutes**; a provider that answers with an error status is retried on the next scheduled refresh instead. Failures never clear the stored catalogs — the last successfully fetched models stay in use and the daemon log records what failed. A refresh in flight is also aborted when the daemon shuts down.

Models fetched by a background refresh appear the next time a client asks for the model list, so a model selector left open across a refresh may need to be reopened.

To turn the background refresh off entirely, set `PI_WEB_OFFLINE` or `PI_OFFLINE` in the session daemon's environment and restart it. In offline mode Forgerie performs no provider catalog network requests, including after logins, and sessions use the catalogs already stored in the agent profile. The `PI_WEB_SKIP_VERSION_CHECK` and `PI_SKIP_VERSION_CHECK` keys do **not** affect this refresh; they only suppress Forgerie release checks.

### Session daemon tools

`spawnSessions` controls whether agents receive the `spawn_session` tool. It defaults to `true`; set it to `false` if you do not want an agent to start independent Forgerie sessions.

`subsessions` is beta and controls whether agents receive the tracked-subsession tools: `spawn_subsession`, `list_subsessions`, `check_subsession`, `read_subsession`, and `yield_to_subsessions`. It defaults to `false` and also requires `spawnSessions` to be enabled.

Tracked subsessions are join-oriented. Calling `spawn_subsession` returns immediately, so the parent can continue independent work while the child runs. Work whose result the parent does not need to join belongs in the fire-and-forget `spawn_session` tool instead.

At a join point, after finishing its independent work, the parent calls `yield_to_subsessions` alone as the final action in its tool batch. Pi ends a tool batch early only when every result in that batch is terminating. If any tracked child is still working, the action ends the current agent run so the parent becomes idle. If none are working, it does not end the run and clearly reports that there is nothing to wait for.

A completion notice wakes an idle parent or queues behind in-flight work. Each notice lists any other tracked children still working, so the parent can continue work or call `yield_to_subsessions` again at the next join point. Further notices arrive automatically; do not poll. The notice includes the child's final output when it fits. If that output is too long, Forgerie omits it entirely instead of adding a truncated duplicate to the parent's context and directs the parent to retrieve it with `check_subsession`.

`list_subsessions`, `check_subsession`, and `read_subsession` never yield or change control flow. They are for deliberate inspection or recovery, not completion polling. While a child works, agent-facing `check_subsession` and `read_subsession` withhold partial output and direct the parent to continue independent work or yield at the join point. Output becomes available when the child stops. Included output and transcripts follow a labeled marker and come last, after Forgerie guidance.

### Delegated agents

Forgerie bundles [`pi-subagents`](https://github.com/nicobailon/pi-subagents) and loads it into every hosted session, so the `subagent` tool works without a Pi package setting. Agent files, `subagents` settings, and `~/.pi/agent/extensions/subagent/config.json` are read from the Pi profile as usual. Each delegated run appears in the session's Agents panel.

To route a kind of work to a model, write one agent file with a `description` that says when to use it, `advertise: true` so the parent sees it, and `model` (plus optional `fallbackModels`). See the upstream [agents](https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md) and [models](https://github.com/nicobailon/pi-subagents/blob/main/docs/models.md) docs. Agent file changes need `/reload` or a new session; a Forgerie upgrade that changes the bundled version needs a session daemon restart.

If the Pi profile also loads a different `pi-subagents` copy, Forgerie ignores that copy in hosted sessions and reports a warning. To share one version with the terminal, point the profile's package entry at the bundled path that the warning names.

### Model choice for spawned sessions

Both `spawn_session` and `spawn_subsession` accept an optional `model` parameter, given as an exact `provider/model-id` such as `anthropic/claude-sonnet-4-5`. When set, the new session starts on that model instead of inheriting the dispatching session's model. The match is strict: an unknown or malformed value is rejected with an error. A `#provider/model-id` reference in the prompt (see [Prompt completions](#prompt-completions)) is how users ask for a specific model; agents forward that reference as this parameter. The new session also inherits the dispatching session's thinking level, clamped to its model's capabilities.

In **Settings → Session daemon**, these keys are saved on the selected machine. Restart the session daemon on that machine after changing them.

#### `askUser` and `ask_user`

`askUser` controls whether agents receive the core `ask_user` tool. It defaults to `true`; set it to `false`, or set `PI_WEB_ASK_USER=false`, to remove the tool. The environment override accepts `0|1|true|false` and takes precedence over the config file.

Forgerie excludes the `question` tool supplied by Pi extensions from hosted sessions. Agents use `ask_user` instead. Disabling `askUser` does not restore `question`. Extension hooks can still use [extension dialogs](#extension-dialogs) for confirmations and other plugin workflows. This policy does not change the shared Pi profile or standalone terminal sessions.

Use **Settings → Session daemon → Allow agents to ask questions** to change `askUser` on the selected machine. An environment override makes the toggle read-only.

The tool accepts one set of 1–20 questions. Each question has a unique `id`, its `question` text, optional supporting `detail`, up to 12 options with stable values and user-facing labels, and an optional `multiple` flag. The browser always adds a **Custom** free-text answer, including when the model supplies no options. No question is required: the user may leave any of them unanswered.

Calling `ask_user` posts the whole set as one browser form and ends the current agent run instead of waiting for the user. The open form is owned by the session daemon, so it survives a browser disconnect, browser reload, or web/API restart while that daemon keeps running. When the user submits, the answers arrive as a follow-up that wakes the session; each question is reported with its selected option values or free text, or explicitly as unanswered.

Forgerie confirms a partial submission before sending it and names the unanswered questions. Only one ask can be open per session: a later `ask_user` call supersedes the earlier one, reports that fact and its unanswered questions to the model, and turns the earlier card into a read-only transcript record. Submitted and cancelled asks likewise remain readable in the transcript.

Sending an ordinary chat message while a form is open voids the form: the card closes as cancelled and the model is told its questions went unanswered as part of the turn the message itself starts.

Restart the session daemon after changing `askUser` or after upgrading Forgerie to a version that introduces this tool. For the systemd user service, run `systemctl --user restart forgerie-sessiond`.

#### `github_read` and `github_write`

Every hosted session gets two tools for its project's GitHub repo. They act as the machine's [GitHub App](#github-setup), so GitHub shows each write as made by the app's bot account. They work on one repo only: `backlog.github.repo` from the canonical checkout's `.forgerie/config.json`, or the checkout's github.com `origin` remote. Terminal Pi sessions do not get them.

| Tool | Actions |
| --- | --- |
| `github_read` | `issues` lists issues, with `state`, `labels`, `query` (GitHub search), and `limit` up to 50. `issue` reads one issue with its comments. `labels` lists the repo's labels. `prs` lists pull requests. `pr` reads one pull request with its CI checks, reviews, and comments. |
| `github_write` | `create_issue`, `comment`, `edit` (title or body), `close` (with `reason` and an optional closing comment), `reopen`, `label` (`add` and `remove`), `create_pr` (from a branch already pushed), and `merge_pr`. |

The tools apply the backlog's author rule to everything they return. Titles, bodies, and comments by outside contributors are replaced with a note naming the author, unless `backlog.github.authors` is `all`. `github_write` uses only labels that already exist on the repo and refuses others before writing anything. Each body it writes ends with a hidden `<!-- forgerie-session: ID -->` marker that names the session.

`merge_pr` merges by rebase unless `method` is `squash` or `merge`. It refuses a draft, a closed pull request, a branch that conflicts, and a commit where any check run or commit status failed or still runs. It also refuses when no CI ran on the head commit. The merge request names the head commit it checked, so GitHub refuses the merge if someone pushed after the check. Branch protection on GitHub still applies on top of these rules.

Scripts may call `github_read`. Only the model can call `github_write`, so each write shows in the transcript as its own card. When the app lacks a permission, the tool names the permission and the app's settings page. An app created before these tools has `Issues: Read-only`: open the app's **Permissions & events** page on GitHub, set the permissions listed in [GitHub setup](#github-setup), save, and accept the new permissions on each installation.

#### `codemode` and the `codemode` tool

`codemode` controls whether hosted sessions start with Pi's `codemode` tool active. With it, an agent writes one JavaScript script that calls the other tools, for example several reads in parallel, and only what the script prints goes back to the model. It defaults to `true`. Set it to `false`, or set `PI_WEB_CODEMODE=false`, to keep the tool inactive. The environment override accepts `0|1|true|false` and takes precedence over the config file. Pi's reference for scripts is [Codemode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/codemode.md).

Use **Settings → Session daemon → Allow agents to run scripts** to change `codemode` on the selected machine. An environment override makes the toggle read-only.

Forgerie applies this setting in hosted sessions only. It does not write `defaultTools` to the shared Pi profile, because Pi before 0.99 reads `"+codemode"` as a tool name and starts terminal sessions with no built-in tools. To remove the tool completely, add `-builtin:codemode` to the `extensions` setting of the Pi profile.

A script reaches the tools the session already has, and each call goes through the same Pi tool hooks as a direct call. Scripts cannot call `ask_user`, `handoff_session`, `spawn_session`, `spawn_subsession`, `yield_to_subsessions`, or `subagent`. These tools end the run or start a session or agent that the transcript must show, so only the model can call them.

The transcript shows a script as one step. Its detail shows the script, one row for each call the script made with its status and time, and the script output. A call inside a script has no tool card of its own: Pi keeps the name, arguments, status, and time of each call, but not its result. Images that the script shows appear with the step. While a script runs, the live status line names the call that the script is making.

Scripts can also run classifier models, such as TypeSafe's Jev, through `models.classify()`. A classifier uses the credentials of its provider in the Pi profile, for example `TYPESAFE_API_KEY` or a `typesafe` entry in `auth.json`. Restart the session daemon after you add a provider credential.

### Extension dialogs

Pi extensions can ask the user questions from `ctx.ui.confirm()`, `ctx.ui.select()`, and `ctx.ui.input()` — including from `session_start` hooks and in-flight `tool_call` hooks. Forgerie renders these dialogs inline in the session transcript and answers them through a dedicated session-daemon channel, never the prompt queue, so a dialog parked inside a `tool_call` hook cannot deadlock the run. Dialog support is always on; there is no enable flag. See [Pi extension dialogs in Forgerie](plugins.md#pi-extension-dialogs) for behavior details and author guidance.

`extensionDialogsTimeoutMs` is the unattended-dialog safety valve: how long the session daemon waits for an answer before settling the dialog with its kind's cancel value (`false` for confirm, `undefined` for select and input). It defaults to `300000` (5 minutes); set it to `0` to wait forever. An extension's own `timeout` option still applies, and the effective deadline is the sooner of the two.

The key is edited directly in the global config file. Restart the session daemon after changing it — for the systemd user service, run `systemctl --user restart forgerie-sessiond`.

### Plugin config

The `plugins` key is only for Forgerie browser plugin enablement/settings on the machine whose config you are editing. It does not install, remove, or update Pi packages; use **Settings → Pi packages** or Pi's package manager for package operations. In a federated setup, **Settings → Forgerie plugins** and **Settings → Pi packages** both target the currently selected machine, and each panel labels where changes will be saved or run.

Plugins are enabled by default. Set `plugins.<id>.enabled` to `false` to remove a plugin from that machine's `/pi-web-plugins/manifest.json` before the browser imports it. Settings lists discovered plugins from the selected machine, including disabled entries exposed by that machine.

```json
{
  "plugins": {
    "relays": { "enabled": true, "settings": {} },
    "updates": { "enabled": false }
  }
}
```

Reload the browser tab after changing plugin enablement. Already-loaded plugin JavaScript is not unloaded from the current page.

### Shortcut config

Shortcut values are keyed by action id. Use physical `ctrl`, `alt`, and `shift` modifiers. Forgerie rejects `meta`, `cmd`, `command`, `gui`, `primary`, and `option`. The first chord must start with Ctrl or Alt. Separate sequence chords with a space, as in `ctrl+k ctrl+s`. Use `null` to disable an action's shortcut.

Legacy `mod` values from older config files are accepted during load. Overrides that only repeated an old built-in default are removed so the new keymap can take effect. Other legacy values are normalized to `ctrl`. New values and interactive edits must use the current grammar.

```json
{
  "shortcuts": {
    "core:actions.show": "ctrl+alt+p",
    "core:session.stop": null
  }
}
```

Custom shortcuts override defaults. Equal-priority conflicts stay inactive until you change one binding. Settings reports both direct conflicts and sequence-prefix conflicts before you save.

The browser keeps control of some shortcuts and does not deliver them to the page. This includes browser-tab and window commands on some platforms. Every Forgerie command remains available through a visible control or the Actions palette.

#### Default keymap

| Action | Action id | Shortcut |
| --- | --- | --- |
| Show Actions | `core:actions.show` | `Ctrl+Shift+P` |
| Focus Prompt | `core:prompt.focus` | `Ctrl+Alt+I` |
| Open Settings | `core:settings.open` | `Ctrl+,` |
| Open Keyboard Shortcuts | `core:settings.shortcuts` | `Ctrl+K Ctrl+S` |
| Go to Files | `core:view.files` | `Ctrl+Shift+E` |
| Go to Git | `core:view.git` | `Ctrl+Shift+G` |
| Go to Terminal | `core:view.terminal` | <code>Ctrl+&#96;</code> |
| New session | `core:session.start` | `Ctrl+Enter` |
| New Rapidfire session | `core:session.start-rapidfire` | `Ctrl+Shift+Enter` |
| Speak to Session | `app.session.speak` | `Ctrl+Alt+Enter` |

The keymap follows VS Code command meanings where those commands exist in Forgerie. It uses Ctrl on every operating system. Command and GUI keys do not run Forgerie shortcuts. The `Ctrl+K Ctrl+S` sequence starts only from the workbench, so `Ctrl+K` remains available to the composer and terminal.

Prefer **Settings → Keyboard** for recording, typing, disabling, resetting, filtering, and resolving shortcut conflicts.

## Prompt completions

The chat composer opens completion menus on three trigger characters:

- `/` at the very start of the draft completes session commands.
- `@` completes file paths: `@` for tracked files, `@ ` (at, then space) or `!@` for all files. Picking one inserts an `@path` reference into the draft, quoted automatically when the path contains spaces.
- `#` completes the models available to the session, filtered case-insensitively as you type (at most 12 entries). Picking one inserts a `#provider/model-id` reference into the draft, which tells agents the request should run on that model — for example as the `model` parameter of `spawn_session`.

## Saving a prompt

Both paths below write to the active agent profile's prompt library at `<agent dir>/prompts/<name>.md` — `~/.pi/agent/prompts/` in the default profile. The prompt is then available as `/<name>` in every session and in the TUI, because Forgerie and Pi read the same profile.

**New Prompt dialog** — the primary path. Open the Actions palette with `Ctrl+Shift+P` and run **New Prompt**. It needs no open session and no composer draft: type a command name, type the prompt, save. `Ctrl+Enter` saves from either field, because Enter types a newline in the prompt body. The dialog reports the written path, and **Write another** clears both fields without reopening it.

The dialog posts to `POST /api/machines/<machineId>/prompts` with `{ name, body }`, so a prompt can also be written to a registered remote machine's profile, or from a script.

**`/prompt-new <name>` in the composer** — a shortcut when the prompt text is already in the message you are typing. It saves the rest of the message.

```text
/prompt-new tell
Speak in ASD-STE100 Simplified Technical English.
```

Rules for both paths:

- The prompt body keeps its line breaks.
- The description shown in the command picker is the first body line, shortened to 120 characters. To control the frontmatter yourself, start the body with `---`; a body that opens that way is written to disk unchanged.
- Names are lowercased, and a leading `/` is dropped, so phone autocapitalization is not an error. Names accept lowercase letters, digits, and dashes.
- Forgerie never overwrites an existing prompt and never accepts a name that a built-in command already uses. Both are refused with the conflicting path or name.
- New sessions see the prompt at once. `/prompt-new` also reloads its own session's Pi resources so `/<name>` works there immediately; while that session is busy the file is still written and the reply says to run `/reload`. After using the dialog, run `/reload` in sessions that are already open.

## Optional completion tools

File and path `@` completions work without extra tools. If `fzf` is available on the Forgerie server's `PATH`, Forgerie uses it to improve completion filtering/ranking; otherwise it falls back to built-in ranking.
