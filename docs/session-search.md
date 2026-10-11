# Session search

Session search reads user text and assistant replies from every branch of active
and archived sessions in the active agent profile. It does not search thinking,
tools, images, custom messages, injected blocks, or agent-spawned child sessions.
The implementation belongs to GitHub issue `forgerie/forgerie#37`.

## Browser contract

Wire types live in `src/shared/sessionSearch.ts`.

```text
GET /api/sessions/search?q=retry%20%22connection%20lost%22&scope=/repo&limit=50
GET /api/sessions/:sessionId/search-matches?q=retry&cwd=/repo
```

Both routes also work under `/api/machines/local/sessions/`. Sessiond registers
`/sessions/search` and `/sessions/:sessionId/search-matches` without an API prefix.
The existing web proxy forwards both routes. The static search route is registered
before the other session routes.

- Whitespace separates terms. Double quotes enclose a phrase. Doubled quotes
  inside a phrase produce a literal quote. An unfinished phrase consumes the
  remaining query. Terms shorter than three characters are ignored.
- Matching is case-insensitive substring matching. Every term must occur in the
  session, but terms can occur in different messages. FTS syntax is not accepted:
  the worker quotes every term and binds the resulting expression as a parameter.
- A search hit has the newest matching message's passage, at most 240 UTF-16 code
  units. `marks` are `[start, end]` offsets into that passage. `timestamp` is an ISO
  string. `otherMatches` counts the other matching messages, not occurrences.
- The live machine catalog supplies `title`, `cwd`, `modified`, and `archived`.
  Missing sessions, known ghosts, and agent-spawned sessions are dropped.
- Repeated absolute `scope` folders form a union. `/repo` includes `/repo/sub`,
  but not `/repo-other`. No scope includes all indexed sessions.
- Hits use catalog `modified` descending, then session id ascending for ties.
  `limit` defaults to 50 and is capped at 100. `nextCursor` is opaque and bound to
  the parsed query and scopes. Pass it unchanged for the next page.
- `index` reports `building` or `ready` and counts eligible files. During a scan,
  `indexedFiles` counts completed or unchanged files. Unreadable files are logged
  and skipped. Search requests wait for initial file discovery, so the first response
  has the complete eligible-file count rather than an unknown zero total.
- No usable term returns 400 with `code: "query_too_short"`. Bad scopes, cursors,
  limits, or missing cwd return 400 with `code: "invalid_request"`. An unavailable
  index returns 503 with `code: "index_unavailable"`; other session routes remain
  available.

`search-matches` returns matching entry ids and roles. It computes `offBranch`
from the live branch at request time. On-branch matches are ordered by `position`;
off-branch matches follow and have no position. `position` is the raw message's
index in `historyMessages()`, including displayed custom messages, summaries,
and tool results. This is the same coordinate system as message paging, not an
index into the browser's filtered rendering. The mapping reuses the history
projection; it does not infer positions from index rows.

A search hit's `offBranch` is only an indexing-time snapshot. Use
`search-matches` before navigating a passage. An off-branch passage must not
switch the current branch.

## Extraction sources

The exact skill block is:

```xml
<skill name="NAME" location="PATH">
References are relative to BASE_DIR.

BODY
</skill>
```

Forgerie produces this in `src/server/sessions/commandCatalog.ts`,
`formatSkillInvocation()`. Pi 1.1.0 produces the same shape in
`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`,
`_expandSkillCommand()` (line 1677 in the installed package).

Pi's CLI file processor produces these blocks:

```xml
<file name="ABSOLUTE_PATH">
FILE_CONTENT
</file>
<file name="ABSOLUTE_PATH">IMAGE_PROCESSING_HINTS</file>
<file name="ABSOLUTE_PATH"></file>
```

Source: Pi 1.1.0,
`node_modules/@earendil-works/pi-coding-agent/dist/cli/file-processor.js`,
`processFileArguments()` (lines 39, 50, 53, and 60). Failed image processing also
uses the same `<file name="…">…</file>` wrapper. Forgerie's browser attachments
are image content parts or saved workspace files, not another injected text
wrapper; see `src/server/sessions/attachmentService.ts` and `prompt()` in
`piSessionService.ts`.

The extractor removes complete `<skill …>…</skill>` and `<file …>…</file>` blocks
from user text only. It keeps assistant `text` parts. It never reads a `thinking`
part's text, a tool call's arguments, a tool result, or custom-message content.

## Index ownership and lifecycle

`SessionSearchService` owns one worker thread. The worker owns the SQLite
connections, source-file reads, extraction, FTS queries, and branch snapshots.
Sessiond owns the live catalog and the authoritative branch position mapping.

The database is `join(piWebDataDir(env), "session-search.sqlite")`, created with
mode `0600`. It uses FTS5 `tokenize='trigram'`, external message content, and
transactional per-file updates. A read-only WAL connection serves only committed
file updates, including during a build. Schema version and extraction version are stored
in SQLite; changing either rebuilds the derived index.

Startup discovers the active profile's `sessions/` recursively, including archive
folders. It processes newest files first and skips unchanged size, mtime, dev,
and inode tuples. The reader streams complete JSONL lines, retaining parent ids
for all entries and searchable text for message entries only. A source file is
always opened with `"r"`. An incomplete final line resumes at its previous
newline after the next append.

Run settlement refreshes one file from its last complete byte offset. The hook
is `agent_settled` in `PiSessionService.bindRuntime()`, not the earlier
`agent_end`: SDK agent-end handlers and retries can still change the transcript.
The Durable adapter also projects the journal before emitting run-end events.
A smaller file or a different dev/inode causes a full per-file rebuild. Same-size
mtime changes also rebuild.

Archive, restore, and archived deletion schedule a catch-up scan. Paths refresh
without changing session identity or duplicating messages. A completed directory
walk removes indexed sessions whose files are gone. Unreadable directories fail
the scan rather than being mistaken for mass deletion. There is no periodic
external-Pi watcher: external changes are caught at startup or the next catch-up
scan. Hosted runs refresh at settlement.

## Read-only full-build measurement on zao

A clean temporary database was built on Node 24.13.0 against
`/home/simonwjackson/.local/share/forgerie/agent/sessions`. No deployed database,
profile, or service was changed. The source store occupied 68 GB as reported by
`du -sh`. OS page caches were not cleared.

| Measurement | Value |
|---|---:|
| Full build wall time, including worker startup | 214.029 s |
| Eligible files indexed | 8,717 / 8,717 |
| SQLite size after WAL checkpoint | 963,719,168 bytes (919.074 MiB) |
| Whole-process peak RSS, including worker | 425,924 KiB (415.941 MiB) |
| Logged skipped paths | 103 |

The skipped paths included one broken archived symlink, 35 subagent transcript
artifacts, and 67 files without a valid initial session header. Child sessions
were excluded separately by their header mark. Files without a session header
also fail the existing catalog's identity rules; this work does not repair them.
The live store could change during the read-only scan.

The measurement database and log were written under
`/tmp/forgerie-search-release-l8NEwt/`. Wall time used `performance.now()` immediately
after `await search.scan()`. Peak RSS used `process.resourceUsage().maxRSS` after
worker shutdown. Size used `stat()` after the WAL checkpoint.

Earlier independent clean runs, before the final committed-reader check:

| Run | Wall time | SQLite bytes | Peak RSS (KiB) |
|---|---:|---:|---:|
| Initial build, including a search and shutdown | 235.214 s | 961,241,088 | 457,512 |
| Build-only repeat | 229.502 s | 963,923,968 | 440,752 |

These are observations, not a controlled comparison. The store was live and the
OS cache was warm on repeats.

Tests cover extraction, parsing, lifecycle, partial HTTP results during a worker
build, live catalog joining, paging, branch positions, run settlement, and both
proxy prefixes. A compiled-worker smoke test also served both routes over real
HTTP on temporary localhost ports. The browser worker owns UI and device
acceptance.
