---
"forgerie": patch
---

Retire unused PiWeb browser plugins, remote-machine proxies, embedded terminals, browser login flows, tracked-subsession execution, generic installers, and Smart Turn execution from the local Forgerie product.

Keep Pi profiles and extensions, current app-plugin settings, account meters, session shell commands, managed processes, pi-subagents, Durable children, Whisper dictation, and historical child-session links. Retired APIs return 404. Local runtime diagnostics and controls for existing systemd user units remain.

Include the existing pinned Pi SDK in the installed package so the CLI and model runtime can load their dependencies.

Build from the checkout using Node 24. Deployment requires an approved idle window and is separate from this source cleanup.
