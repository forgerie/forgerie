# skills

Distributable agent skills developed alongside Forgerie.

## handoff

Compact the current conversation into a handoff document, then immediately
spawn the continuation session via `spawn_session`.

Local install: symlink `skills/handoff` into `~/.pi/agent/skills/handoff` so
the TUI and Forgerie sessions share one copy.

## relay

Execute a long or complex plan as a chain of independent sessions, each running
one well-sized leg and handing off to the next via `spawn_session`.

```bash
npx skills add jmfederico/pi-web --skill relay -a pi -g
```
