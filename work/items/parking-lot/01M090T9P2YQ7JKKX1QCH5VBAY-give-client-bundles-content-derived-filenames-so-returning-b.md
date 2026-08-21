---
id: 01M090T9P2YQ7JKKX1QCH5VBAY
slug: give-client-bundles-content-derived-filenames-so-returning-b
title: Give client bundles content-derived filenames so returning browsers cannot serve stale JS
origin: parked
status: To Do
priority: medium
labels:
  - client
  - build
  - caching
created: 2026-08-17
source: se-work
---

# Give client bundles content-derived filenames so returning browsers cannot serve stale JS

## Why it matters

Two builds in this session emitted the same asset filename with different content: dist/client/assets/index-B4beJP1H.js was served before the 17:26 build and still after it, yet the post-build file contains the string "No history entries match this filter", which did not exist in the source at the time of the earlier build. Identical URL plus changed content means any browser holding the old asset can keep running stale client code indefinitely, since hashed asset URLs are normally served with long-lived immutable caching. Fresh capture profiles hide the problem, so it only bites returning users after a deploy.

## Acceptance Criteria

- [ ] Two builds whose client sources differ produce different asset filenames
- [ ] vite.config.ts pins rollup output entryFileNames/chunkFileNames/assetFileNames to include a content hash, or the current hashing behaviour is proven content-derived and this item is closed with evidence
- [ ] A deploy is verified by observing the served index.html reference a new filename

## Related

- `vite.config.ts`
- `dist/client/assets`

## Notes

Found while deploying slice 11a of the UI polish program. Not caused by that work.
