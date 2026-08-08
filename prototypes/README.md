# Prototypes

Throwaway visual prototypes. **Nothing here ships and nothing here is wired
into the app.**

This directory is deliberately outside every tool's scope:

| Tool | Scope | Sees `prototypes/`? |
|---|---|---|
| `tsc` | `tsconfig.json` `include` | no |
| `eslint` | `eslint.config.js` `files` | no |
| `knip` | `knip.json` `project` | no |
| `vite` | `src/client` | no |

So `npm run verify` is unaffected by anything in here.

## Running one

Prototypes are plain ES modules with no build step. They need an HTTP server
(ES module imports do not work over `file://`):

```bash
cd prototypes
python3 -m http.server 8600
# then open http://127.0.0.1:8600/session-board/
```

## Current prototypes

- [`session-board/`](./session-board/) — the inbox redesign. Sessions become
  the root list, grouped by **what they need from you** instead of **where they
  live**. Open `session-board/index.html` through the prototype server.
