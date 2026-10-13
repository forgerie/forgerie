# Forgerie

Forgerie is a browser control surface for persistent [Pi Coding Agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) sessions. Agents run in real workspaces on your server. You can read, steer, stop, and answer them from a browser.

## Local development

Use a Linux server with Node 24, npm, Git, and a configured Pi profile. Native Windows server installation is unsupported. Windows browsers can still connect. The repository pins its Pi SDK versions in `package.json`.

```bash
nix shell nixpkgs#nodejs_24 -c npm ci
nix shell nixpkgs#nodejs_24 -c npm run dev
```

The install also installs the browser app's dependencies. Open the Vite URL, normally `http://localhost:8510`.

```bash
nix shell nixpkgs#nodejs_24 -c npm run verify
nix shell nixpkgs#nodejs_24 -c npm run build
```

The app includes projects, session worktrees, chat, files, diffs, backlog items, Pi packages and extensions, account meters, managed processes, and delegated agents. Dictation uses a separate Whisper worker. A session can run shell commands without an embedded terminal.

## Configuration and deployment

[Configuration](docs/config.md) explains profiles, environment variables, and dictation. [Plugins](docs/plugins.md) covers Pi extensions and current browser-app plugins. [Deployment](docs/deployment.md) covers existing systemd user units. [Triggers](docs/triggers.md) covers scheduled workflows and missed runs.

The `forgerie` CLI controls existing Linux service units. It does not install services. The web server and session daemon also have separate built entrypoints. Keep the app on a trusted private network. Forgerie has no login barrier and is not a sandbox or a multi-tenant service.

Forgerie retains `PI_WEB_*` environment names and some `pi-web` API and storage identifiers for existing profiles and extensions. See the [fork cleanup](docs/fork-cleanup.md) for retired features and upgrade limits.

## License and origin

MIT. The upstream copyright remains in [LICENSE](LICENSE).
