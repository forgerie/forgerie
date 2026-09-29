# Forgerie assistant-ui MVP

A standalone React + Vite client for one existing Pi session. It uses assistant-ui's `ExternalStoreRuntime` and the existing Forgerie server. The backend and original Lit client stay unchanged.

## Run

Keep Forgerie running on `http://127.0.0.1:8504`. From this directory:

```sh
nix shell nixpkgs#nodejs_22 -c npm ci
nix shell nixpkgs#nodejs_22 -c npm run dev
```

Open `http://127.0.0.1:8510/?session=<existing-session-id>`.

The app resolves the session's `cwd` through `/api/sessions/all`, loads its history, and subscribes to its events. Send a text message or press Stop during a run. The dev proxy handles HTTP and binary WebSocket frames. The dev server binds only to loopback. For another computer, forward port 8510 over SSH rather than expose it publicly.

This worktree uses the orphan branch `new-ui-mvp`. It has no shared history with `main`. It is not a replacement deployment or an npm release.

## Verify

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
nix shell nixpkgs#nodejs_22 -c npm audit
```

See [verification](verification/README.md) for the real-session acceptance command, posture captures, evidence, and limits. Sending through that command changes the selected session's real history and incurs normal model usage.

Forgerie is an MIT-licensed fork of Federico Jaramillo Martinez's pi-web. See `LICENSE`.
