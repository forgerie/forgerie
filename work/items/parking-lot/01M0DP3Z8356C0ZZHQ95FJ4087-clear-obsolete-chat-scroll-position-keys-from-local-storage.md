---
id: 01M0DP3Z8356C0ZZHQ95FJ4087
slug: clear-obsolete-chat-scroll-position-keys-from-local-storage
title: Clear obsolete chat scroll position keys from local storage
origin: parked
status: To Do
priority: low
labels:
  - client
  - cleanup
  - storage
created: 2026-08-19
source: se-work
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: fix/open-chat-at-bottom
  commit: 66daff9
  repo: forgerie
  invoked_by: se-work
---

# Clear obsolete chat scroll position keys from local storage

## Why it matters

The bottom-first chat flow no longer reads `pi-web:chat-scroll:*` entries. Existing installations can retain inert keys for every previously viewed session.

## Acceptance Criteria

- [ ] Remove obsolete `pi-web:chat-scroll:*` keys once without affecting unrelated local storage.
- [ ] Add a regression test that preserves unrelated keys.
- [ ] Document or test that the cleanup is safe when local storage access fails.

## Related

- `src/client/src/chatScrollPosition.ts`
- `src/client/src/components/ChatView.ts`

## Notes

Discovered while removing saved chat position restoration. Keep this outside the bottom-first behavior commit.
