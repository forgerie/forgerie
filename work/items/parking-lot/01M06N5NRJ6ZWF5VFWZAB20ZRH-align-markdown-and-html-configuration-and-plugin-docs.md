---
id: 01M06N5NRJ6ZWF5VFWZAB20ZRH
slug: align-markdown-and-html-configuration-and-plugin-docs
title: Align Markdown and HTML configuration and plugin docs
origin: parked
status: To Do
priority: medium
labels:
  - docs
  - configuration
  - plugins
created: 2026-08-17
source: se-work
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: refactor/remove-workspace-tasks
  repo: forgerie
  invoked_by: se-code-review
---

# Align Markdown and HTML configuration and plugin docs

## Why it matters

The HTML docs still name `.pi-web/config.json` while the Markdown and runtime use `.forgerie/config.json`. The Markdown plugin guide also documents Relays without an equivalent HTML section. These pre-existing mismatches can send users to an ignored config path and make current plugin examples incomplete.

## Acceptance Criteria

- [ ] `docs/config.html` uses `.forgerie/config.json` everywhere the runtime expects project-local config.
- [ ] `docs/config.md` and `docs/config.html` state the same project-local config path.
- [ ] `docs/plugins.md` and `docs/plugins.html` describe the same built-in plugin set, including Relays.
- [ ] Copy-button targets remain valid after the HTML edits.
- [ ] Relevant docs tests and `git diff --check` pass.

## Related

- `docs/config.md`
- `docs/config.html`
- `docs/plugins.md`
- `docs/plugins.html`
- `src/server/workspaces/projectPiWebConfig.ts`
