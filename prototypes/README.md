# Prototypes

Prototypes do not ship with Forgerie and do not run as part of its production build. Each experiment owns its setup and data. Keep active experiments separate from source cleanup.

## Retained experiments

| Directory | Purpose |
| --- | --- |
| [`voice-content/`](voice-content/) | Independent speech and narration experiment with its own server and flake. Its speech stack is separate from production dictation. |
| [`pen-context/`](pen-context/) | Pen input, transcript marking, diff review, and drawing experiments. |
| [`skills-and-prompts/`](skills-and-prompts/) | Active session-lens and Settings-library mockup. |
| [`logo-tally/`](logo-tally/) | Logo candidates drawn from the chat's tally marks. |

Read an experiment's own README before starting or stopping it. A plain HTML experiment can run from a local HTTP server; use the managed process tool when starting one from an agent session.

Retired prototypes remain in Git history and the source archive documented in [fork cleanup](../docs/fork-cleanup.md). Do not remove another chat's untracked experiments or running prototype services.
