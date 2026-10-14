# Plugins and Pi packages

Settings lists the active daemon profile's Pi packages and extension files, current browser-app plugins, and built-in agent tools.

| Kind | Where it runs | What Settings changes |
| --- | --- | --- |
| Pi package | In agent sessions. | Install, enable, disable, or remove a configured package. |
| Pi extension | In agent sessions. | Enable or disable an extension file in the active profile. |
| Forgerie app plugin | In the current browser app. | Enablement and declared settings apply at once. |
| Built-in tool | In hosted agent sessions. | Read-only information; Settings cannot remove it. |

Packages and extensions run with the server user's permissions. Install only code you trust. Disabling or removing a configured package does not delete its source files.

## Pi packages and extensions

Open Settings, then Plugins. Install a package using an npm source, Git URL, or local path. The page shows the active profile directory and flags missing packages. A package can expose tools, skills, prompts, or extensions.

Pi package operations use the active profile reported by sessiond. Saving a different desired profile does not redirect a running daemon's package writes. If sessiond cannot report a valid profile, profile-dependent operations fail instead of choosing another profile.

Package and extension changes can need a daemon restart. Settings keeps the restart notice until the active state catches up. Provider registrations freeze at daemon startup; `/reload` does not apply global provider changes.

Restarting stops running agents. Use an approved idle window. The restart action asks for confirmation. If host-side restart is unavailable, follow [deployment](deployment.md).

Forgerie ships pinned `pi-web-access` 0.39.0 and its own `process` tool. Their hosted tools remain available without installing another browser plugin. Web search uses keyless Exa with no profile configuration. See [web search](web-search.md). Delegation is built in through Durable children. See [child agents](child-agents.md). Hosted sessions also load Pi's built-in MCP extension; see [MCP servers](mcp.md).

## Managed processes

The agent uses `process` for commands that continue while it works. Open **Managed processes** in the session header to read output, write stdin, close stdin, or stop a command. The panel shows the same session-owned records after reconnecting. stdout and stderr share one ordered log.

Managed processes survive Forgerie restarts on hosts with a working `systemd --user` manager. Session close (archive, delete, or worktree removal) ends them. Closing a browser does not close the session. A handoff or fork leaves them with their original session. Workspace services are separate: a worktree owns those services.

On hosts without a systemd user manager, Forgerie starts an **attached process** and labels it “ends when Forgerie restarts”. If a supervisor disappears, Forgerie reports a **lost process** with reason “supervisor lost”. It never runs that command again by itself. Check what the old command did before starting another.

A child process ends when its child run finishes unless the child sets `keepAfterChild: true`. A kept child process still ends at session close. Exits and watched output missed during a restart reach the session on resume with the watch's requested attention.

Forgerie no longer installs `@aliou/pi-processes`. Hosted sessions ignore a copy in the Pi profile and warn with its path. Remove that copy and restart in an approved window: extension factories ran before filtering, so removing hooks cannot undo their earlier side effects.

## Current browser-app plugins

The current app owns its plugin UI and manifests. `src/shared/appPluginManifests.ts` declares their settings. The shipped account meters use the `cliproxyapi-quota` ID so existing meter preferences remain valid.

```json
{
  "plugins": {
    "cliproxyapi-quota": {
      "enabled": true,
      "settings": {
        "five_hour": true,
        "seven_day": true,
        "endpoint": "https://cliproxyapi.hummingbird-lake.ts.net/quota"
      }
    }
  }
}
```

Use the declared Settings fields rather than a generic JSON editor. Switches save at once. An address waits for Save. Draft text stays in memory, not browser storage.

The current Settings API uses `/aui/plugins` and revision-checked mutations. The active-profile Pi package API remains at `/api/pi-packages`. Neither API discovers or serves upstream browser plugins.

## Retired original-client plugins

The original browser-plugin runtime, bundled plugin assets, public declaration package, discovery, and mutation APIs are retired. `/api/plugins` and `/pi-web-plugins/` assets return 404, including when the app serves browser navigation through its SPA fallback.

Existing config entries remain data, but undiscovered original-client plugins no longer appear in Settings. Pi extensions, current app plugins, account meters, managed processes, and delegated agents remain supported. See [fork cleanup](fork-cleanup.md) for the full retired-feature list.

## Decision hints

Decision hints is an off-by-default gateway connection for optional attention and
risk information. See [Decision hints](decision-hints.md) for configuration,
privacy and server-only key setup. The annotations are a later integration stage.
