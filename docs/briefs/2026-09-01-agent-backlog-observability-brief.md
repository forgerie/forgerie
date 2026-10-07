---
date: 2026-09-01
topic: agent-backlog-observability
artifact: brief
---

# Agent Backlog Observability

## Chosen Thing

Evolve the existing se-backlog system (repo-local `work/items/` markdown files plus the `backlog_*` tools) into an agent-operated backlog that the user observes through Forgerie. Storage stays file-based and repo-local. Forgerie aggregates every project's backlog into one read surface. Agents remain the primary writers; the user's job is to see, not to file-manage.

No ecosystem tool is adopted. Ideas are borrowed (claims, dependencies, readiness, staleness) from Beads, pi-worklist, and Backlog.md, but the markdown-plus-git store and the skill-driven capture flow stay.

## Users and Context

One user runs many concurrent Pi sessions across many projects through Forgerie. Backlog items are captured ambiently by SE skills during work. Today the backlog is a directory of ULID-named markdown files with no view: the user does not browse files while using Forgerie, so parked work is invisible, staleness goes unnoticed, and picking the next item requires asking an agent to summarize.

Direction (context, not scope): the project is heading toward agents that pick up backlog items autonomously, including overnight. The data model chosen here must not preclude that, but no dispatch tooling is built now.

Ecosystem survey (2026-09-01): se-backlog leads every surveyed Pi tool on ambient capture and dedup discipline, and trails on claims, dependency/ready computation, and visibility. This brief closes the second set of gaps without giving up the first.

## Goals

- **Observability in Forgerie.** A backlog panel that aggregates `work/items/` across all registered projects: parked and active items, status, priority, source, age, and claim. Read-only first. The panel is the human browse surface; filenames stop mattering.
- **Staleness made visible.** Track a `updated:` timestamp on every mutation. The panel and `backlog_list` surface age; items untouched past a threshold get a visible staleness marker. Prune remains a deliberate, agent-mediated act; the panel nudges, it never deletes on its own.
- **One canonical copy per repo, worktree-safe.** Backlog state is repo-scoped, not branch-scoped. Tools resolve the canonical `work/items/` directory through the git common dir (`git rev-parse --git-common-dir` → default worktree root), so every worktree reads and writes the same files. This is deterministic path resolution with git plumbing, not cross-branch state peeking. Feature-branch commits therefore never carry divergent backlog copies, and atomic commits stay clean.
- **Claims recorded at promotion.** `backlog_promote` records the claiming branch (and Pi session ULID when available) in the item's frontmatter. With a single canonical copy, a claim written by one session is immediately visible to every other session and to the panel.
- **Agent-maintained dependencies and readiness.** Optional `blocked_by:` frontmatter listing item ULIDs. Agents create and update edges; the user never hand-edits them. `backlog_list` computes ready (open, unblocked, unclaimed) and the panel renders blocked/ready/claimed distinctly.
- **Focused context for dedicated sessions.** When a session exists to execute a backlog item, the promotion hand-off injects the full item file (they are small) and names the backlog tools so the agent knows it can pull related items. No other injection exists: sessions not dedicated to backlog work receive nothing automatically.

## Non-Goals

- No autonomous dispatch or overnight pickup. The data model must support it later (claims, readiness, canonical state); nothing schedules or launches sessions from the backlog now.
- No adoption of Beads, Backlog.md, pi-worklist, or any second store. No database, no daemon-owned backlog state; Forgerie reads the files.
- No global backlog store. Items live in their repos. Cross-project is a read view only.
- No blanket prompt injection. No per-turn or session-start backlog block for ordinary sessions.
- No human file-management workflow. Filename ergonomics are solved by the panel, not by renaming. The ULID-first `<id>-<slug>.md` scheme stays for time-sortability and coordination-free minting. Revisit only if hand-browsing turns out to matter after the panel exists.
- No write-capable panel in the first slice. How much control the user wants over the system is explicitly undecided; the read-only panel exists partly to find out.

## Decisions

1. **Evolve se-backlog; do not adopt.** The capture and hygiene discipline is the differentiated part; the missing parts are cheap to add.
2. **Canonical backlog lives in the default worktree, resolved via the git common dir.** This answers "which version of the ticket is correct in a worktree" without hacks: there is only one version. Cost: backlog changes appear as working-tree churn in the main checkout (already the documented behavior) and are committed there at natural checkpoints, never on feature branches.
3. **Claims are frontmatter, not locks.** `claimed_by: <branch>` plus `claimed_session: <ulid>` on promote; cleared on removal or explicit release. Advisory, single-writer-per-item by convention. Good enough for worktree-isolated solo work; revisit if dispatch automation arrives. *Superseded on 2026-10-06; see Amendments.*
4. **Dependencies are agent-owned metadata.** `blocked_by:` edges validated on write (existing ids, no self-reference). Readiness is derived at read time, never stored.
5. **Forgerie panel ships read-only and multi-project.** The server already knows project checkouts; it parses frontmatter and serves a typed list. Triage actions (reprioritize, drop, edit) are a follow-up decision after the user has lived with the read view.
6. **Item context loads at promotion, on purpose.** Full file content into the dedicated session's opening prompt, plus a pointer to `backlog_list` for related items. Everything else stays pull-based.

## Open Questions

- **Panel depth.** Read-only vs triage vs dispatch is deliberately unresolved; the user wants to develop a feel. Ship read-only, then decide.
- **Staleness threshold.** Start at 30 days (pi-worklist's convention) and tune from the panel.
- **Active-item ID cleanup.** `work/items/active/` mixes ULID and timestamp-style names from before the current scheme. One-time migration is cheap but low value; decide when the panel makes the inconsistency visible.
- **Where claims are released.** Removal clearly releases; whether landing a PR should auto-release (and how the tool detects it) is unresolved.

## Amendments (2026-10-06)

Recorded after a survey of Orca's task page, Beads, pi-worklist 0.17.0, and @harms-haus/pi-tasks, and after confirming the state of the backlog tools on this machine. These amend the Decisions above and are not to be reopened without new evidence.

### Findings that forced the amendments

- The `backlog_*` tools this brief assumes do not exist as described. The nearest thing is `~/code/github/simonwjackson/pi-software-engineering-rebuild` (`work_item_create|list|get|update|close|validate`). It is not installed (absent from `settings.json` packages, last commit 2026-07-17) and uses a different layout: `work/<id>-<slug>/work.md` with a `stage` field, no claims, and close-out deletes the directory.
- Three item schemes are in use across this machine's repos: Forgerie's `work/items/{active,parking-lot,completed}/<ulid>-<slug>.md`, the rebuild's `work/<id>/work.md`, and Backlog.md's `backlog/task-NNN - slug.md` in bazzar, nix-on-rocks, and korri. None has an installed writer.
- Orca's launcher is not "one tap spawns an agent". It is item list → prefilled new-workspace composer → user confirms → isolated workspace plus thread, with a badge on the item row linking back. Forgerie's global new-session composer already plays the middle role.
- Beads' claim semantics are the reference: atomic (first writer wins, repeat by the same owner is idempotent), owner plus location, explicit release, stale-write guard, and leases only because Beads cannot see its agents.

### A1. Backlog directory: `.forgerie/backlog/` by default, per-project override

The default backlog directory is `.forgerie/backlog/`, relative to the canonical repo root (common-dir resolution from Decision 2 still applies). A project overrides it with `backlog.dir` in `.forgerie/config.json`, the same per-project file that already carries `pathAccess` and `uploads`. This repo sets `work/items/`. The scanner reads exactly one directory per project and never guesses.

### A2. Tracked by default; warn when ignored

Item content belongs in git. Forgerie warns when the resolved backlog directory is git-ignored and keeps serving it. The warning names the fix, because the common case is a wholesale `.forgerie/` ignore (this repo, `.gitignore:17`): replace it with `.forgerie/*` and `!.forgerie/backlog/`.

### A3. Claims live only in Forgerie's store; Decision 3 is superseded

Forgerie is the claim writer, not an agent tool, and the claim is not written into the item file at all. Forgerie launches the session, so claim and launch are one atomic step: check unclaimed, record `{ itemId, projectId, sessionId, branch or worktree, claimedAt }` in Forgerie's own store under `~/.local/share/forgerie/`, then create the session. Forgerie hosts the session, so it knows liveness directly: release fires when the session is archived or deleted. No lease, no expiry, no mirror into frontmatter.

Why no mirror: a claim written into a tracked file on launch and cleared on archive is working-tree churn that may never be committed, and once committed it is stale for every later reader. An agent may still write `claimed_by: <branch>` into an item in its own commit as information; Forgerie never reads that as a claim.

Known cost: a teammate without Forgerie sees no claim. Two Forgerie hosts on one repo have two claim stores and no arbiter. Both are accepted until a second host exists; at that point leases return regardless of whether the file carries a mirror.

### A4. Item schema: current frontmatter plus `blocked_by`, body opaque

The scanner parses the frontmatter the existing files already carry (`id`, `title`, `status`, `priority`, `labels`, `created`, `source`) plus `blocked_by: [<id>, ...]`. Readiness is derived at read time (Decision 4): an item is blocked when any `blocked_by` id is an open item in the same project, otherwise ready. Unknown frontmatter keys are ignored. The markdown body is opaque text; the launcher passes it through unchanged as the first prompt. No installed writer produces `blocked_by` yet, so until one exists the edges come from agents editing files by hand.

### A5. Claim is truth; `status` is a label; launch never writes the item file

The panel renders a live Forgerie claim as the item's real state and shows the file's `status` as a label beside it. Launch does not move the file between `parking-lot/` and `active/` and does not rewrite `status`. The backend is read-only against the repo. Known cost: a reader of the files alone sees no sign of progress until an agent commits an edit.

### Effect on the Sequence

Step 1 below has no tool to amend and is dropped from the launcher's path. Step 2 (`blocked_by`, readiness) folds into the scanner per A4. Steps 3 and 4 become the launcher: a read-only multi-project panel reading `backlog.dir`, plus a launch action that claims in Forgerie's store and opens the new-session composer prefilled with the item file as the first prompt. Any agent-side writer is decided separately once one is installed.

## Sequence

1. Canonical-path resolution in the `backlog_*` tools (common-dir root), plus `updated:` touch and claim fields on promote. Small, self-contained, unblocks everything else. *Dropped from the launcher path on 2026-10-06; see Amendments.*
2. `blocked_by:` support and ready computation in `backlog_list`.
3. Forgerie read-only backlog panel, multi-project, with age and claim badges.
4. Promotion hand-off that injects the item into a dedicated session.
5. Re-evaluate: panel write actions, dispatch, ID migration.
