---
id: 01M0EX569FHNB9EWDYT3PHD80A
slug: ghost-sessions-listall-surfaces-files-no-mutation-path-can-r
title: "Ghost sessions: listAll surfaces files no mutation path can resolve"
origin: parked
status: To Do
priority: high
labels:
  - sessions
  - data-integrity
created: 2026-08-20
source: se-debug
---

# Ghost sessions: listAll surfaces files no mutation path can resolve

## Why it matters

listAll reports sessions by header cwd regardless of which cwd-encoded directory holds the file, but resolveSessionFile requires storage directory AND header cwd to both match the requested cwd (test: "does not resolve sessions that belong to another cwd"). A session file stored under a stale/renamed cwd directory with a different header cwd is therefore listed in the inbox but 404s ("Session not found") on archive, pin, open — from every cwd. Reproduced live with 019e74ac… duplicated across --…forgerie-next--/ and --…forgerie-ext--/ with header cwd /home/simonwjackson/.pi: archive returned 404 for cwd=.pi and for both directory-matching cwds. User-visible result: permanent unremovable rows. Manual remediation required moving files into the header-matching directory before the API would act.

## Acceptance Criteria

- [ ] Listing and resolution share one ownership rule (centralized policy module), so any listed session is actionable
- [ ] A session whose storage dir disagrees with its header cwd is either resolved via its listed path or reconciled/flagged, never a silent 404
- [ ] Regression test: file under wrong cwd-encoded dir with mismatched header is both listed and archivable (or excluded from listing entirely)

## Related

- `src/server/sessions/piSessionManagerGateway.ts`
- `src/server/sessions/piSessionManagerGateway.test.ts`
- `src/server/sessions/piSessionService.ts`

Subsumes `01KZJMACABQFMXCJD5ETFWW7JB` (bulk archive failures across stale catalog entries in ROCKNIX, Korri, Amaze Next).
