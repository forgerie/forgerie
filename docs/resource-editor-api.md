# Skills and prompts API

The backend provides one file editor through a Settings library and a session lens. The frontend is separate work. Shared schemas and TypeScript types live in `src/shared/resourceEditor.ts`.

## Decisions

Settings lists user/profile, package, and Forgerie-bundled resources. It does not select a project. The session lens adds resources for that session's actual cwd, including its worktree. The daemon resolves the profile and cwd. Clients cannot supply a filesystem path or substitute a different cwd.

The user selected automatic commits for saves in the main checkout. Here, "main checkout" means the primary Git checkout, regardless of its current branch name. A save never switches branches or pushes.

| File location | Save effect |
| --- | --- |
| User/profile file | Write the file without a Git operation. |
| Project file in the primary checkout | Write the file and commit only that path on the current branch. |
| Project file in a linked worktree | Write the file as an uncommitted change. |
| Project file without Git | Write the file without a commit. The API reports `uncommitted`. |
| Inherited project file outside the session's checkout | Read-only. Open a session in its owning checkout to edit it. |
| Package or bundled resource | Read-only. Package updates replace these files. |

Main-checkout commits require an attached branch, an existing commit, a tracked and clean target file, and no unfinished Git operation. Assume-unchanged and skip-worktree flags block saves. Git's `--only` excludes other staged or unstaged files. Git runs the repository's hooks with a 60-second command limit. Hooks are trusted repository code and can modify files or fail. The server verifies the resulting commit's parent and file set before reporting success.

If a commit fails after the write, the response sets `savedToDisk: true`. A failed hook normally leaves the edit uncommitted. A commit can already exist if its final verification fails. The client must not label this as a successful resource-only commit or retry blindly. Ask the user to inspect Git status and the latest commit. A dirty target blocks another automatic commit. No rollback, automatic stash, or automatic reset occurs.

## Endpoints

The browser uses the `/api` prefix. The web server proxies these routes to the session daemon. The following paths follow that prefix.

| Method | Path | Response schema |
| --- | --- | --- |
| GET | `/resources` | `ResourceEditorInventorySchema` |
| GET | `/resources/:resourceId` | `ResourceEditorFileSchema` |
| PUT | `/resources/:resourceId` | `ResourceEditorSaveSchema` |
| DELETE | `/resources/:resourceId` | `ResourceEditorDeleteSchema` |
| GET | `/sessions/:sessionId/resources` | `ResourceEditorInventorySchema` |
| GET | `/sessions/:sessionId/resources/:resourceId` | `ResourceEditorFileSchema` |
| PUT | `/sessions/:sessionId/resources/:resourceId` | `ResourceEditorSaveSchema` |
| DELETE | `/sessions/:sessionId/resources/:resourceId` | `ResourceEditorDeleteSchema` |

The daemon has the same routes without the browser prefix. All editor routes reject query parameters. Use the full session ID, not an ID prefix. Each request resolves the current inventory again. An ID absent from that scope returns 404, even if another scope listed it earlier.

The editor reads and edits existing files. It also deletes writable prompt files, including prose workflows. It does not delete skills or context files. This version does not create, rename, or copy resources. It does not edit JSON settings, extension code, or skill companion files. Agent-role Markdown remains in the existing `/aui/agents` editor.

## Inventory

The response contains `scope`, `basis`, `resources`, `diagnostics`, and `maxFileBytes`.

`scope` is `{ kind: "settings" }` or `{ kind: "session", sessionId, cwd }`. The returned cwd is authoritative.

`basis` is `configured-files-on-disk`. It describes configured file discovery now, not the resources already loaded in a running session. Browsing does not open a session, run extensions, install packages, or reload resources. Dynamically contributed extension resources are not scanned. Missing packages appear in diagnostics instead of triggering an install.

Each resource has these fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable, opaque SHA-256 identity for the file's kind and configured path. It is not a filesystem path or an authorization token. |
| `kind` | `skill`, `prompt`, or `context`. |
| `name`, `description` | File metadata for the list. A skill name comes from Pi's skill parser. A prompt name comes from its filename. |
| `path` | Absolute configured path for display. Do not send it back as a write target. |
| `origin` | `{ kind, source, scope, root }`. Kind is `user`, `project`, `package`, or `bundled`. Scope is Pi's `user`, `project`, or `temporary` scope. |
| `activation` | `active`, `shadowed` with `winnerId`, `disabled`, or `invalid` with `message`. This is file-discovery state, not live-session state. |
| `manual` | True when a skill sets `disable-model-invocation`. False for prompts and context. |
| `edit` | `writable` with `saveEffect`, or `read-only` with an explanation in `reason`. The server rechecks this on save. |

Keep shadowed, disabled, and invalid rows visible. A user can edit an invalid skill to fix it. Editing a shadowed file does not make it the winner.

Skills and prompts use the SDK package resolver, including configured paths, package filters, project settings, ancestor skill directories, and the global `~/.agents/skills` folder. Hosted bundled packages precede normal configured sources. Duplicate physical skill files do not create multiple active winners.

Context includes the profile's selected context file, the session's SDK-selected ancestor context files, and the profile/project `SYSTEM.md` and `APPEND_SYSTEM.md`. Context filename precedence follows Pi: `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, then `CLAUDE.MD`. Lower-priority alternatives appear as shadowed rows. A nested worktree excludes the main ancestor context when Pi excludes it.

## Read and save

A file read returns `{ resource, text, revision }`. `text` is the exact UTF-8 file, including frontmatter, line endings, and any BOM. `revision` includes file identity, modification times, and content. Do not derive it in the browser.

A PUT body must contain only:

```json
{
  "text": "the complete replacement file text\n",
  "baseRevision": "the 64-character revision returned by GET"
}
```

A save returns `{ file, effect, reload }`. `file` has the same shape as a read. `effect.kind` is `unchanged`, `file-only`, `uncommitted`, or `committed`. A committed effect also has `sha` and `branch`. Unchanged text does not create a commit. Refetch the inventory after a save because names and collision relationships can change.

The editor preserves permissions and replaces files through a synced temporary file and rename. It checks revisions before replacement and serializes editor saves. Symlinked files, hard links, binary files, and symlink escapes below the configured root are read-only. These checks do not make unrelated filesystem writers transactional participants.

Files are limited to 1 MiB of UTF-8 bytes. Discovery is limited to 1000 resources and bounded directory scans. At most four editor operations run concurrently.

`reload` is always `explicit-session-reload`. Saving never reloads a running session. The frontend can offer the existing `POST /sessions/:sessionId/reload` with `{ "cwd": "the returned session cwd" }`. Stop active session work first. Reload affects that session only. A profile edit can affect other sessions when they next reload or start.

## Delete a prompt file

Read the file first. Send DELETE to its resource URL with only `{ "baseRevision": "the revision from GET" }`. Deletion uses the same permissions, revision checks, file queue, cross-process lock, and Git rules as saves. Package, bundled, linked, inherited, and read-only session files remain protected.

A successful deletion returns `{ resourceId, effect, reload }`. Its effect is `file-only`, `uncommitted`, or `committed`, with the same meanings as saves. Refetch the inventory. A repeated deletion returns 404. Deleting a project override can expose a matching profile prompt.

Deletion does not reload sessions or erase workflow snapshots. A loaded SDK prompt can remain available until explicit reload. New workflow admissions read files from disk. Accepted workflow retries keep their frozen definition even after deletion.

If Git or final verification fails after removal, the existing compatibility field `savedToDisk: true` means the deletion applied. The file is gone. Inspect Git status before retrying. The API does not restore it automatically. There is no new browser delete control in this backend change.

## Errors

Editor errors use `ResourceEditorErrorSchema`:

```json
{
  "error": {
    "kind": "conflict",
    "message": "This file changed on disk. Read it again before saving.",
    "savedToDisk": false
  }
}
```

| HTTP status | Error kind | Client action |
| --- | --- | --- |
| 400 | `invalid-request` | Fix the body, ID, or query parameters. |
| 403 | `read-only` | Show the reason and disable Save. |
| 404 | `not-found` | Refetch the inventory. The resource or session is no longer available. |
| 409 | `conflict` | Keep the draft. Read the new version and let the user resolve it. |
| 409 | `unsafe-git-state` | Resolve the Git precondition before saving. No write occurred. |
| 409 | `commit-failed` | The file change applied. Inspect Git status and the latest commit before completing or correcting it outside the editor. |
| 413 | `over-limit` | Reduce the file size or inventory size. |
| 500 | `io-error` | Show the error. Check `savedToDisk` before offering a retry. |
| 503 | `busy` | Retry later. The daemon includes `Retry-After: 1`. |

HTTP parser, body-size, transport, and proxy failures can use the existing Fastify/proxy error shape instead. Clients must handle those failures too.
