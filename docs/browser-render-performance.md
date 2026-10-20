# Browser rendering performance

This page records how the transcript renderer keeps work off the critical path, and the evidence for each choice. Session selection, retention, prefetch and the wire protocol belong to [session-browser-lifecycle.md](session-browser-lifecycle.md) and [briefs/fast-chat-open.md](briefs/fast-chat-open.md). This page does not repeat them.

## Code highlighting loads on first use

The full highlight.js build (193 grammars, 378 names and aliases) is an optional chunk. A code sheet (`ui/src/ui/CodeSheetBody.tsx`) loads it only when two things are true: the sheet's code is finished, and its fence label names a known language. Until the chunk arrives, the sheet shows the exact source as plain, escaped text. The text stays selectable and focusable, keeps its accessible name, and browser find can reach it.

| Rule | Why |
| --- | --- |
| `codeLanguageNames.ts` holds every full-build name and alias. The composer and the transcript use it to recognize a fence label. | Recognizing a label does not load a grammar. A test compares every grammar and alias with highlight.js, so a dependency update cannot drop a language without notice. |
| All grammars stay in one chunk, loaded once and shared by every sheet. | Embedded languages (for example, HTML that contains CSS and JavaScript) need the whole registry. Loading per language could highlight differently depending on load order. |
| Streaming code is never highlighted. | A half-written token would colour wrongly. This rule is not new. |
| A selection inside a sheet holds back the colour swap until the selection leaves the sheet. | Colouring replaces the text nodes, which would collapse the reader's selection. The check uses `Range.intersectsNode`, because `Selection.containsNode(node, true)` returns false when the whole selection lies inside the node. |
| If the chunk fails to load, the failure is logged once and every sheet keeps its readable source. | The source text is the content. Colour is an enhancement. |
| `CodeSheetBody` is memoized. | A parent render with unchanged code does not highlight the code again. |

Cost: the first finished code fence after a page load fetches and evaluates a 979 kB chunk (313 kB gzip). Text appears first and colour follows. The settled render does not change: before and after screenshots of the same fixture match pixel for pixel, at 1440×900 and 475×638, in light and dark. These are desktop Chromium emulations, not a physical device.

## Evidence (2026-10-20)

All runs below used the production UI build against the classic fixture `scripts/fast-chat-open-server.mjs` (`small` 20 turns and `large` 300 turns). Each turn ends with a 60-line TypeScript fence. Both builds were served at the same time, before on port 18643 and after on port 18653. The runs alternated between builds in each round. Each measurement client held the shared heavy-check slot. The fixture servers ran outside it. Host: 16 cores, with a 1-minute load average of 6.6 to 10.7 during the runs. Other lanes were active, so host load was not controlled.

| Measure (Chromium 155, desktop emulation 1440×900 DPR1) | Before `5dd83bc0` | After | Change |
| --- | ---: | ---: | --- |
| Initial entry script, decoded bytes | 3,552,628 | 2,578,387 | −27.4 % |
| Initial entry script, gzip −9 | 1,107,865 | 797,595 | −28.0 % |
| First visit with HTTP cache disabled (n=100): catalog ready, median / p95 | 252.8 / 466.5 ms | 234.0 / 341.2 ms | faster |
| Same: `DOMContentLoaded`, median / p95 | 194.6 / 348.8 ms | 174.3 / 266.2 ms | faster |
| Same: long-task time per boot, median | 51 ms | 0 ms | lower |
| Same: click to unique reply visible (first useful rAF), median / p95 | 208.5 / 377.1 ms | 131.3 / 254.2 ms | faster |
| Same: next-rAF paint opportunity after that, median / p95 | 221.8 / 406.8 ms | 224.0 / 391.0 ms | no change |
| Same: click to exact final code coloured (first use of the chunk), median / p95 / max | 208.6 / 377.1 / 1027.0 ms | 209.8 / 365.9 / 521.8 ms | no regression |
| Warm switches, 5 alternating rounds × 200 per build: useful rAF, median / p95 / p99 | 48.3 / 69.1 / 85.4 ms | 46.4 / 84.7 / 97.6 ms | not shown to change; see below |

How to read this table:

- The useful frame comes earlier, but the next paint opportunity does not. Fetching and evaluating the chunk fills the gap. Do not report this change as faster painted content. rAF timestamps are not compositor presentation times.
- The warm-switch tails differ by round. In the after build, the round medians ranged from 42.7 to 59.4 ms, and the two worst rounds ran while the load rose to 9.3–10.7. The before build ranged from 47.3 to 49.6 ms. The highlighter is already loaded during warm switches, so this change should not affect them. Nothing here shows a warm-switch improvement. Rerun under controlled load before you draw a conclusion.
- All counts include every sample. No sample failed. p95 is shown only from 100 samples and p99 only from 1,000.

The raw files, the harness copies and the CPU profile are in `/tmp/forgerie-stack-latency/cefda578-browser-render/`: `coldvisit-*`, `paired-*`, `rounds-summary.txt`, `paired-summary.txt` and `shots/`.

## The composer editor survives a hidden session

A retained session is hidden by React `Activity`, not unmounted. Activity runs layout-effect cleanups on hide, so the composer used to destroy its CodeMirror `EditorView` on every hide and build a new one on every reveal. Building it read the document selection, which forced a synchronous layout of the whole revealed transcript. The editor then inserted its own DOM and measured it, which forced a second layout.

`ui/src/ui/ComposerEditor.tsx` now keeps the editor across a hide:

| Rule | Why |
| --- | --- |
| On reveal, the kept editor is presented as the fresh editor it replaces: the composer's draft, the caret at the end, and no undo history from before the switch. | Keyboard behaviour stays the same. When the caret is already at the end and the history is empty, nothing is dispatched. |
| The draft still comes only from the assistant-ui composer. The existing value effect syncs a draft that changed while the session was hidden. | No second draft source. |
| Each bar's mount, reveal and hide sweeps the kept editors and destroys every editor whose bar left the document. | React runs no effect for a bar that is removed while hidden. A hidden bar stays in the document and a removed one does not. The registry evicts a session when another opens, so the next bar sweeps the evicted editor. |

Cost: a hidden editor keeps its CodeMirror listeners (document `selectionchange`, window `resize` and `scroll`) until its session is evicted. Each listener returns early for an editor that is not focused, so the cost per event is small, but it is not measured. The session registry bounds the number of kept editors.

Evidence: same fixture and harness as above. Head is `596b6358` and the candidate is this change. They were served at the same time and alternated each round. Host load was 3.5 to 19.7, uncontrolled.

| Warm switch, useful rAF, 5 rounds × 200 per build | Head | Candidate |
| --- | ---: | ---: |
| Median / p95 / p99 | 57.1 / 170.9 / 238.4 ms | 38.0 / 67.8 / 102.4 ms |
| Next-rAF paint opportunity, median / p95 | 82.5 / 263.4 ms | 53.4 / 90.7 ms |
| Long tasks (count / max) | 175 / 168 ms | 11 / 88 ms |
| Round median, candidate minus head | — | −10.7, −80.1, −85.6, −23.2, −1.5 ms |

Two earlier gates with a prototype of the same idea agreed: candidate faster in 8 of 10 rounds. A trace of 100 switches at load 6 to 7 measured layout per switch at a median of 36.6 ms (head) against 23.4 ms (candidate). The rest is the one layout the browser must do anyway. The head-build tails are wide because two head rounds ran at load 13 to 19, so the medians and the per-round signs are firmer than the p95 ratio. Raw files: `composer-*.json`, `reveal-*.json` and `composer-gate-summary.txt` in the artifact directory.
