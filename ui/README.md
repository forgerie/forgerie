# Forgerie assistant-ui MVP

A standalone React + Vite client for one existing Pi session. It uses assistant-ui's `ExternalStoreRuntime` and adapts the [homepage demo UI](THIRD_PARTY_NOTICES.md), including formatted Markdown replies. The backend and original Lit client stay unchanged.

## Run

Keep Forgerie running on `http://127.0.0.1:8504`. From this directory:

```sh
nix shell nixpkgs#nodejs_22 -c npm ci
nix shell nixpkgs#nodejs_22 -c npm run dev
```

Open `http://[::1]:8510/?session=<existing-session-id>` locally, or use the server's Tailscale address on port 8510. Voice dictation on a remote device needs [HTTPS setup](verification/dictation.md).

The app resolves the session's `cwd` through `/api/sessions/all`, loads its history, and subscribes to its events. Reloading or opening another tab attaches to the same server-owned run without sending another prompt. Connection loss triggers automatic recovery. See [the resume contract](verification/resumable-streams.md) for limits, including daemon restarts. Send a message, attach files with the + button, or press Stop during a run. See [attachment behavior and limits](verification/README.md#attachments). Use the microphone to dictate, then stop to insert the transcript into your draft. When the agent calls `ask_user`, the message box shows its questions and answers them until you send the answers or skip them. Unsent text and partial answers survive a session switch and a reload in the same browser. See [draft protection](verification/drafts.md). The dev proxy handles HTTP and binary WebSocket frames. The dev server binds to `::` on port 8510 and accepts loopback hosts by default. Set `FORGERIE_AUI_ALLOWED_HOSTS` to a comma-separated list of additional hostnames before remote use. There is no app authentication. Any client that can reach this port can use the proxied Forgerie API. Restrict access with Tailscale and the host firewall. Do not expose the port to the public internet.

Type `/` at the start of the composer to discover Pi commands. Select a command, add arguments, then Send. See [slash commands](verification/slash-commands.md) for behavior and endpoint checks.

Type `/tree`, or press the tree button in the header, to move the session to an earlier entry or fork from it. See [session tree](verification/session-tree.md).

Press the archive button in the header to archive the session and open the next one waiting for you. See [archive and next](verification/archive-next.md).

The input bar shows the session's model and thinking level. Press it, or send `/model`, to change either one. See [model and thinking level](verification/model-thinking.md).

When the agent hands off to a new session or spawns one, the reply shows an "Open session" button beside that call. See [handoff navigation](verification/handoff-navigation.md).

Type `!command` to run a shell command in the session's folder, or `!!command` to keep its output out of the agent's context. See [shell commands](verification/shell.md) for behavior and limits, including that a running command cannot be stopped from this client yet.

This worktree uses the orphan branch `new-ui-mvp`. It has no shared history with `main`. It is not a replacement deployment or an npm release.

## Verify

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
nix shell nixpkgs#nodejs_22 -c npm audit
```

See [verification](verification/README.md) for the real-session acceptance command, posture captures, evidence, and limits. Sending through that command changes the selected session's real history and incurs normal model usage.

Forgerie is an MIT-licensed fork of Federico Jaramillo Martinez's pi-web. See `LICENSE`.
