# Fork cleanup

This cleanup removes unused upstream features from the local Forgerie product. It does not merge upstream code, move `upstream.lock`, or remove MIT attribution.

## Retired features

| Removed | Current replacement or limit |
| --- | --- |
| Native Windows server support and the Windows CI job. | Run the server on Linux. Windows browser access remains. npm rejects native Windows installation. WSL2 has not been verified. |
| Original browser-plugin runtime, bundled assets, declaration package, discovery, and settings editor. | Pi packages, Pi extensions, and current app-plugin settings remain. |
| Remote-machine registry, proxies, and configuration wrappers. | One local server. The current browser's local-only URL aliases remain; they do not imply federation. |
| Embedded PTYs and terminal-command runs. | Session shell commands and managed processes remain. |
| Terminal-based workspace deletion. | Session-owned worktrees keep Land, Discard, ownership checks, and pre-remove hooks. There is no replacement API for deleting arbitrary unowned worktrees. |
| Browser OAuth and API-key login flows. | Configure credentials in the actual Pi profile. Existing stored credentials remain usable. |
| Tracked-subsession spawning, control, and completion notices. | Normal sessions, `pi-subagents`, and opt-in Durable children remain. Historical links stay in session data and retain reciprocal-file validation. |
| Release-registry discovery, installation detection, and generic service installers. | Local version diagnostics and controls for existing systemd user units remain. |
| Production Smart Turn workers and check-turn endpoint. | User-driven Whisper dictation remains. Status keeps the inert compatibility field. |
| Standalone HTML documentation site and retired development probes. | Current Markdown guides and browser-app verification remain. |

Retired routes return 404 instead of serving the SPA's HTML. In particular, original plugin assets and APIs, browser-auth routes, remote-machine routes, terminal APIs, and `/api/speech/check-turn` no longer exist.

Local diagnostics remain at `/api/pi-web/runtime`, `/api/pi-web/version`, and `/api/pi-web/status`. These inherited names are retained contracts, not a release-update service.

The follow-up cleanup removes unused Smart Turn budgets, timers, thread settings, and endpoint-only PCM branches. Whisper keeps its existing upload, queue, transcription, and restart limits. Speech status keeps the inert `smartTurn` field and endpoint-window limits for wire compatibility. Browser pause-candidate timing and historical benchmark evidence remain. Workspace activity keeps `hasTerminalActivity: false` for compatibility, but automatic worktree cleanup no longer checks that always-false field.

## Data and active work

The cleanup does not delete credentials, profiles, runtime databases, session journals, or `.pi-web/handoffs`. A historical tracked child remains a session. Verified historical children retain delegation restrictions and unread exclusion. The daemon no longer reopens a parent runtime to send a legacy completion notice.

The independent `prototypes/voice-content`, `prototypes/pen-context`, and `prototypes/skills-and-prompts` experiments remain. New active prototype work is not cleanup material. Other chats' worktrees and dirty files must remain untouched.

## Archived source

On zao, the deleted source is archived outside the repository under:

```text
~/.local/share/forgerie/cleanup-archives/fork-cleanup/
  retired-source.tar.gz
  manifest.json
  retired-followup.tar.gz
  followup-manifest.json
  complete-retired-source.tar.gz
  complete-manifest.json
```

The complete archive contains the pre-cleanup versions of all 685 deleted tracked files. Its SHA256 is `27aedb0b348a107f73554641e96863b63e5023e5f75460fe71061cd12703fe29`.

The initial archive's SHA256 is `9775920650d920a278c8d5765493c032501f7cba611108b2cd79a9c7f78ae181`. The follow-up archive's SHA256 is `741004806a1216dedb977e232cb3fc142c071e6fc5f483985fe99a62492be751`.

The manifests name the retired files. The archives preserve source, not an operational deployment or a data backup. Extract them into a separate directory for inspection. Do not overlay an active checkout. Git history also retains the original files.

## Installed package

The package includes the pinned Pi SDK `1.1.0` used by the checkout. The SDK packages are runtime dependencies, not consumer-provided peers. Bundling the SDK increases the tarball size, but prevents npm from marking omitted peer files as bundled dependencies during installation.

Forgerie still uses the SDK for models and credentials, persisted session files, extension loading, and coding tools. Durable runs the parent agent loop; `pi-subagents` also uses the SDK's agent-session factory. Removing the SDK requires replacements for these contracts. Its CLI and terminal UI exports are part of the SDK package, not the retired PiWeb browser runtime. This cleanup does not strip SDK internals.

`npm run smoke:package-install` installs the tarball with npm `12.0.1`, executes the installed CLI, and creates an offline model runtime with an isolated profile. It checks that stored test credentials remain unchanged. It also checks the patched process sources, pinned subagent version, and exclusion of retired files. It does not launch a delegated agent or prove configured agent execution.

## Deployment boundary

The approved cleanup runs dependency installation, builds, and tests in an isolated worktree. Source can land on `main` without changing the deployed build. This operation must not restart web, sessiond, or the Tailscale proxy while agents are running.

Until an approved deployment, the running instance still uses its existing `dist/` and dependencies. Follow [deployment](deployment.md) when the operator authorizes that change. No runtime data migration is part of this source cleanup.
