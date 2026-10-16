# Session-history, usage and skill-load audits

Find the active profile before searching. `/api/pi-web/runtime` reports
`components.sessiond.activeAgentProfile.dir`; saved `agent.dir` can differ until sessiond restarts.
See [active profiles and overrides](config.md#desired-and-active-profiles).
App data uses `PI_WEB_DATA_DIR`, or `~/.forgerie` when unset
([resolver](../src/config.ts)). The installed profile on this host uses
`~/.local/share/forgerie` for app data and its `agent` folder for the profile;
these are deployment paths, not portable defaults.

| Audit | Start here | Reader and limits |
| --- | --- | --- |
| Active session history | `<active-profile>/sessions/**/*.jsonl`; on this host `~/.local/share/forgerie/agent/sessions` | [SessionDirResolver](../src/server/sessions/piSessionManagerGateway.ts) resolves session-directory environment overrides, then Pi settings, then the profile default. SDK `parseSessionEntries` reads JSONL. Check the header `cwd` and session ID; include project worktrees. |
| Archived history | `<app-data>/archived-sessions/*.jsonl`; on this host `~/.local/share/forgerie/archived-sessions` | [SessionArchiveStore](../src/server/sessions/sessionArchiveStore.ts) owns the archive index and file moves. |
| Native parent and child conversations | Beside a session JSONL: `.durable/<session-filename>/state.sqlite` | [durableSessionPaths](../src/server/sessions/durableSessionJournal.ts), [native history reader](../src/server/sessions/durableNativeHistory.ts), and [migration notes](pi-durable-migration.md). Follow [Durable locators](../src/server/sessions/durableSessionAddress.ts): forks can share a journal. JSONL is a compatibility projection, not the complete native journal; `original.jsonl` preserves pre-import history when present. Use Durable storage APIs rather than guessing SQLite columns. |
| Usage and cost | Each conversation's committed `pi.usage` (`UsageDoc`) | [Parent statistics/accounting](durable-tool-replay.md#parent-statistics), [journal reader](../src/server/sessions/durableSessionJournal.ts), [usage contract](../src/shared/durableUsage.ts). Transcript sums miss compaction and failed attempts; child spend is separate. Estimates are not bills. |
| Child-run history | `<app-data>/child-runs.json`; read-only `GET /api/sessions/children/runs` | [Run history API and accounting](child-agents.md#run-history-api), [route](../src/server/sessions/childRunRoutes.ts), [store](../src/server/sessions/childRunStore.ts). Optional exact `session` and `agent` filters. One record per run, not conversation; completed records expire after 90 days and are not a historical backfill. Missing usage is `null`, not zero. Reads do not resume work. |
| Skill loads | Successful `read` tool calls/results for `SKILL.md`, and explicit `/skill:` invocations in the source history | [Invocation reader](../src/server/sessions/durableAgentSession.ts), [child skill selection](../src/server/sessions/durableChildRuntime.ts). Distinguish offered skills from loaded files. A listed skill or attempted/failed read does not prove a load, and a load does not prove the agent followed it. Include child conversations. |

## Existing retro extractor

This host has `~/.local/share/forgerie/nightly-retro/session-digest.py`:

```sh
python3 ~/.local/share/forgerie/nightly-retro/session-digest.py \
  --cwd /absolute/project --hours 24 --out /tmp/session-audit
```

It writes one Markdown digest per session plus `index.json`. Digest line 2 names
the source JSONL; `L<n>` cites its original line. It selects header `cwd` equal
to the project or below it, then filters entries by time. It summarizes user
turns, assistant text/tool calls, errors, and large result sizes.

Limits: the script hard-codes this host's two JSONL roots, scans only root files
and one subdirectory, filters file modification time first, skips `.durable`,
malformed JSON and entries without timestamps, and excludes its own retro runs.
It clips text and omits ordinary successful results, thinking, usage and native
child histories. Use it to locate evidence, then read the source and native
ledgers. It is a local utility, not a repository-shipped or complete accounting
or skill-load reader. Treat transcripts and tool arguments as private data.
