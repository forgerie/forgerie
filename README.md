# Forgerie

Forgerie is a browser control surface for persistent [Pi Coding Agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) sessions. It runs agents in real workspaces on a server or workstation and keeps the browser as the control surface.

Forgerie is a hard fork of [PI WEB](https://github.com/jmfederico/pi-web). It is currently developed and deployed as a local product. It is not published to npm or hosted in a public Forgerie repository.

## What it provides

- persistent Pi sessions that survive browser disconnects;
- projects and git worktrees on the machine where the code lives;
- parallel session supervision from desktop and mobile browsers;
- web-native chat, file, git, task, relay, and update surfaces;
- an embedded terminal as an escape hatch;
- remote-machine federation for trusted Forgerie runtimes.

## Local development

Requirements:

- Node.js 22.19.0 or newer;
- npm;
- Pi Coding Agent `>=0.83.0` configured for the current user;
- git and the development tools used by agent sessions.

Install dependencies and start the development services:

```bash
npm install
npm run dev
```

Open the Vite URL, normally `http://localhost:8505`.

Build and verify the product with:

```bash
npm run build
npm run verify
```

The package exposes `forgerie`, `forgerie-server`, and `forgerie-sessiond` binaries. The deployed zao instance runs the built server files directly through machine-local systemd user units.

## Configuration

Forgerie keeps the inherited `PI_WEB_*` environment variable names and selected `pi-web` API/storage identifiers for compatibility with existing profiles and extensions. New default application data paths use the Forgerie name.

See [configuration](docs/config.md) and [plugins](docs/plugins.md) for detailed reference material. Some inherited documentation still describes upstream installation and deployment modes that the local Forgerie deployment does not use.

## Security

Forgerie assumes trusted users, repositories, and server paths. It is not a sandbox or a multi-tenant service. Put it behind a trusted private network, SSH tunnel, or authenticated reverse proxy. The current deployment is available only through Tailscale.

## License and origin

MIT. Forgerie retains the upstream copyright and attribution in [LICENSE](LICENSE). The fork model and upstream review policy are documented in [AGENTS.md](AGENTS.md).
