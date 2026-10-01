# Forgerie assistant-ui MVP

A standalone React + Vite client for one existing Pi session. It uses assistant-ui's `ExternalStoreRuntime` and adapts the [homepage demo UI](THIRD_PARTY_NOTICES.md), including formatted Markdown replies. The backend and original Lit client stay unchanged.

## Run

Keep Forgerie running on `http://127.0.0.1:8504`. From this directory:

```sh
nix shell nixpkgs#nodejs_22 -c npm ci
nix shell nixpkgs#nodejs_22 -c npm run dev
```

Open `http://[::1]:8510/?session=<existing-session-id>` locally, or use the server's Tailscale address on port 8510.

The app resolves the session's `cwd` through `/api/sessions/all`, loads its history, and subscribes to its events. Reloading or opening another tab attaches to the same server-owned run without sending another prompt. Connection loss triggers automatic recovery. See [the resume contract](verification/resumable-streams.md) for limits, including daemon restarts. Send a text message or press Stop during a run. When the agent calls `ask_user`, the message box shows its questions and answers them until you send the answers or skip them. The dev proxy handles HTTP and binary WebSocket frames. The dev server binds to `::` on port 8510 and accepts every Host header through Vite's `allowedHosts: true`. There is no app authentication. Any client that can reach this port can use the proxied Forgerie API. Restrict access with Tailscale and the host firewall. Do not expose the port to the public internet.

This worktree uses the orphan branch `new-ui-mvp`. It has no shared history with `main`. It is not a replacement deployment or an npm release.

## Verify

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
nix shell nixpkgs#nodejs_22 -c npm audit
```

See [verification](verification/README.md) for the real-session acceptance command, posture captures, evidence, and limits. Sending through that command changes the selected session's real history and incurs normal model usage.

Forgerie is an MIT-licensed fork of Federico Jaramillo Martinez's pi-web. See `LICENSE`.
