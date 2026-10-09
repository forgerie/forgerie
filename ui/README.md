# Forgerie browser app

Forgerie's browser app: React + Vite, built on assistant-ui's `ExternalStoreRuntime`, adapted from its [homepage demo UI](THIRD_PARTY_NOTICES.md). Forgerie's server serves the production build from `dist/client`. The root `npm run build` builds it, and the root `npm install` installs this folder's dependencies. The earlier Lit client is in Git history (removed after `main` `ec6ed17f`).

## Install and update

The app is an installable PWA. Install it from the browser menu; it opens full screen (`display: "fullscreen"` in `public/manifest.webmanifest`). In a browser tab, the icon at the end of the session list's footer enters and leaves full screen. When a new build is deployed, an open app says "A new version of Forgerie is ready" with a Refresh button. It checks `build.json` when it comes back into view or online, and every minute while visible. It never reloads by itself.

## Develop

Keep Forgerie running on `http://127.0.0.1:8504`. From this directory:

```sh
nix shell nixpkgs#nodejs_24 -c npm ci
nix shell nixpkgs#nodejs_24 -c npm run dev
```

Open `http://[::1]:8510/?session=<existing-session-id>` locally, or use the server's Tailscale address on port 8510. Voice dictation on a remote device needs [HTTPS setup](verification/dictation.md).

The app resolves the session's `cwd` through `/api/sessions/all`, loads its history, and subscribes to its events. Reloading or opening another tab attaches to the same server-owned run without sending another prompt. Connection loss triggers automatic recovery. See [the resume contract](verification/resumable-streams.md) for limits, including daemon restarts. Send a message, attach files with the + button, or press Stop during a run. See [attachment behavior and limits](verification/README.md#attachments). Use the microphone to dictate, then stop to insert the transcript into your draft. When the agent calls `ask_user`, the message box shows its questions and answers them until you send the answers or skip them. Unsent text and partial answers survive a session switch and a reload in the same browser. See [draft protection](verification/drafts.md). The dev proxy handles HTTP and binary WebSocket frames. The dev server binds to `::` on port 8510 and accepts loopback hosts by default. Set `FORGERIE_AUI_ALLOWED_HOSTS` to a comma-separated list of additional hostnames before remote use. There is no app authentication. Any client that can reach this port can use the proxied Forgerie API. Restrict access with Tailscale and the host firewall. Do not expose the port to the public internet.

Type `/` at the start of the composer to discover Pi commands. Select a command, add arguments, then Send. See [slash commands](verification/slash-commands.md) for behavior and endpoint checks.

Type `/tree`, or press the tree button in the header, to move the session to an earlier entry or fork from it. See [session tree](verification/session-tree.md).

Press "New session" at the top of the session list, N, or Ctrl+Enter to start a session in a dialog: any project workspace, the model you choose, files, and skills. Rapidfire starts several without leaving it. See [new session](verification/new-session.md).

Press the changes button in the header to read the session's git diff. Select lines, write a note, and the note goes to the agent with your next message. See [notes on changes](verification/diff-notes.md).

A new session in a Git project starts in a fresh worktree from the default branch. Land or discard it from the ⋯ menu in the header. See [session worktrees](verification/session-worktrees.md).

Press the pull request button in the header to see the session's pull requests, one tab each: checks, reviews, open comments, watch, and merge. Its dot shows the most urgent one. Link more by number, or unlink one. See [pull requests](verification/pull-requests.md).

Press the archive button in the header to archive the session and open the next one waiting for you. See [archive and next](verification/archive-next.md).

On a touch screen, swipe right to see the session list and left to put it away. See [swipe to the session list](verification/sheet-swipe.md).

When an extension asks a confirm, select, or input question, it appears on top of the input bar. See [extension dialogs](verification/extension-dialogs.md).

The input bar shows the session's model and thinking level. Press it, or send `/model`, to change either one. See [model and thinking level](verification/model-thinking.md).

When the agent hands off to a new session or spawns one, the reply shows an "Open session" button beside that call. See [handoff navigation](verification/handoff-navigation.md).

Press Settings at the foot of the session list, then Agents, to create and edit the agents a session can hand work to. Each agent is one pi-subagents file in `~/.pi/agent/agents/`. Its name, description, model, and "Offer to sessions" (`advertise`) are a form; its instructions are a Markdown document. A save changes only the header lines you edited and writes the body back only if you edited it. Built-in agents are read-only; Customize saves your own copy, which replaces the built-in one. Changes apply to sessions started after the save. The file API lives in Forgerie's server (`src/server/uiSettings/agentFiles.ts`).

The foot of the session list shows how much quota each AI account has left, read from the CLIProxyAPI router. Press Quota to show or hide them. Turn it off, change the router address, or hide single windows in Settings > Plugins > Account meters. See [account meters](verification/account-meters.md). It is the first plugin bundled with this app: a manifest in `src/shared/appPluginManifests.ts` that the server lists and validates, and an interface registered in `src/plugins/PickerShelves.binding.tsx`.

Type `!command` to run a shell command in the session's folder, or `!!command` to keep its output out of the agent's context. See [shell commands](verification/shell.md) for behavior and limits, including that a running command cannot be stopped from this client yet.

This app was built on the orphan branch `new-ui-mvp` (tag `new-ui-mvp-orphan` keeps its original commits) and moved to `ui/` on `main`. Settings > Agents, Plugins, and Models read and write through Forgerie's server under `/aui/` (`src/server/uiSettings/`).

## Verify

```sh
nix shell nixpkgs#nodejs_24 -c npm run verify
nix shell nixpkgs#nodejs_24 -c npm audit
```

See [verification](verification/README.md) for the real-session acceptance command, posture captures, evidence, and limits. Sending through that command changes the selected session's real history and incurs normal model usage.

Forgerie is an MIT-licensed fork of Federico Jaramillo Martinez's pi-web. See `LICENSE`.
