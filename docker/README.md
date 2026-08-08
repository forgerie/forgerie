# Forgerie Docker assets

Forgerie is local-only. The checked-in Docker support is retained from upstream for future adaptation, but the production image has no public package or asset source.

## Current status

- `docker/compose.dev.yml` can run against a local checkout.
- `docker/compose.yml` requires an explicit `FORGERIE_PACKAGE_SPEC` build argument.
- `docker/install.sh` uses assets from this checkout by default. Remote asset refresh requires an explicit `PI_WEB_DOCKER_ASSET_BASE`.
- No public one-line installer, npm package, prebuilt image, or automatic Docker update path exists.

Do not treat the production Docker path as the supported zao deployment. The live instance runs built files from the checkout through machine-local systemd user units.

### Command matrix

| Command | Purpose |
| --- | --- |
| `install` | Install retained runtime assets |
| `start` | Start services |
| `stop` | Stop services |
| `restart` | Restart all services |
| `restart-web` | Restart the web service |
| `restart-sessiond` | Restart the session daemon |
| `update` | Update when a package source exists |
| `status` | Show service status |
| `logs` | Follow service logs |
| `shell` | Open a service shell |
| `doctor` | Run diagnostics |
| `cli` | Run the Forgerie CLI |

Development commands use the same names, for example `forgerie-docker --dev status` and `./docker/forgerie-docker --dev start`.

### Installer options

The local installer accepts the inherited `PI_WEB_DOCKER_*` options. Remote asset and package options have no defaults while the project remains local-only.

## Local development image

From the repository root:

```bash
cd docker
PI_WEB_DOCKER_DEV_REPO_ROOT=.. docker compose -f compose.dev.yml up --build
```

The inherited `PI_WEB_*` environment variable names remain compatibility interfaces.

## Production image experiment

To test the retained production image, provide a package spec that the Docker build can access:

```bash
cd docker
FORGERIE_PACKAGE_SPEC='<accessible npm spec or package URL>' docker compose build
```

A host-only file path is not accessible during a Docker build unless you add it to the build context. Publishing or designing a durable local-tarball flow is deferred until Forgerie needs a Docker distribution channel.
