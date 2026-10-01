# Streamdown integration

Assistant text and reasoning now use `StreamdownTextPrimitive` from `@assistant-ui/react-streamdown` 0.3.17 with Streamdown 2.6.0. The adapter supports the existing assistant-ui 0.15.22 runtime. Reference: https://www.assistant-ui.com/docs/guides/streamdown.

The user chose to keep the rebuild on `new-ui-mvp`. This change does not enter `main`, replace the Lit client, or restart production services. It uses a separate task worktree and lands by rebase and fast-forward onto `new-ui-mvp`.

## Behavior and limits

- Unfinished bold, inline code, links, and code fences use Streamdown's streaming repair. Completed messages retain literal unfinished syntax instead of synthetic completion.
- The adapter reads each part's running status. Both text and reasoning use the same renderer. User messages remain literal text.
- The existing code sheets, code copy feedback, Highlight.js highlighting, and focusable table scroll regions remain. Code highlights only after its part completes. Wide code and tables scroll inside the reading column.
- `defer` keeps parsing below urgent input updates. No smooth reveal, animated text, or caret is added.
- Images remain links. Raw HTML is skipped. Data images and dangerous URL schemes are blocked. Incomplete link destinations remain text until complete. Bare workspace paths resolve against the document URL rather than becoming blocked labels.
- Stock Streamdown controls are disabled because this app already supplies its controls and has no Tailwind build. The semantic `strong` override avoids Streamdown's default Tailwind-styled span. The extra renderer wrapper uses `.markdown-content` for edge margins.
- Optional Shiki, math, Mermaid, and CJK plugins are not installed. This change adds the renderer, not those additional capabilities.

The SDK's `StreamdownTextComponents` HTML index signature rejects its own narrower code-header/highlighter functions in an object literal under strict TypeScript. Assigning the declared compatibility properties separately preserves their types without casts.

## Checks

Checked on 2026-09-30. The tests use the real assistant-ui runtime and renderer.

| Check | Result |
|---|---|
| `npm run verify` | Build, TypeScript, ESLint, and 174 tests passed after rebasing onto the concurrent activity-grouping, resumable-stream, and slash-command changes. Four new component tests cover unfinished tokens, final code copying, unsafe links, and workspace-relative links. |
| `npm audit` | Zero reported vulnerabilities. |
| `scripts/streamdown-acceptance.mjs` | Passed all four emulated Fold postures in both themes. Real browser updates repaired unfinished text and a fence, completed the table and links, copied exact code, retained the input element and draft, and issued no API or remote-media requests. |
| `scripts/visual-acceptance.mjs` | Passed posture transitions, reduced-height and narrow-pane checks, click and Enter sending in the fixture, stopped/disconnected/reconnecting states, and wide code/table scrolling. |
| `scripts/trace-acceptance.mjs` | Passed all 32 tool/reasoning cases after rebase. The concurrent grouping change already corrects the stale 32 px minimum to the approved 28 px trace-line height. No product target size changed here. |
| `scripts/slash-acceptance.mjs` | Passed the concurrent slash-command fixture after rebase, including keyboard completion, confirmation, ask precedence, all four postures, and reduced-height and narrow-pane cases in both schemes. No live command ran. |
| `scripts/ask-acceptance.mjs` | Passed. The one composer preserved its draft across ask mode and close. All posture, long-question, narrow-pane, and reduced-height cases passed. |
| Real history | `scripts/acceptance.mjs` passed against the existing coordinator session, with 36 message blocks, exact semantic text matching, no duplicate blocks after reload, and the draft retained through all four postures. No prompt was sent. |
| Real reconnect | `scripts/reconnect-acceptance.mjs` passed. It retained the transcript, disclosure, draft, and scroll at 80 CSS pixels. No mutation occurred. |
| Visual review | Read all 16 history and unfinished-code PNGs from `scripts/streamdown-shots.sh`. Code sheets, table borders, type, and composer remain consistent in both schemes and every posture. |

The history check initially found two issues. Streamdown omits incidental newline text nodes between blocks, so the independent verifier now compares text with semantic block boundaries. The renderer initially blocked bare file links because the URL policy lacked a base. Adding the document URL restored those links and removed the extra blocked labels. Later reruns exposed a reload race in the verifier: it queried the document before reload finished. The verifier now waits for `Page.loadEventFired`.

The code and response copy failure tests remain in `src/ui/Thread.test.tsx`. Physical Fold keyboard and touch behavior remain unverified. There is no measured physical Tab Ultra viewport, so no tablet claim is made.

## Bundle cost

Same Vite production command, compared with the realignment commit `7e3faedd`. Values describe the main JavaScript entry, excluding unchanged font files.

| Main entry | Before | With Streamdown |
|---|---:|---:|
| Minified | 1,036.68 kB | 1,398.24 kB |
| Gzip | 318.49 kB | 430.78 kB |

Streamdown adds about 112.29 kB gzip to the entry at that baseline. The final rebased build is 1,407.39 kB minified and 433.53 kB gzip, including the concurrent activity, recovery, and slash-command changes. The build also emits a 0.46 kB lazy chunk, 0.32 kB gzip. The existing Vite large-bundle warning remains. This integration does not claim a measured speed improvement.

## Repeat

Run in the MVP worktree with its dev server on 8510. Set `APP_URL` for a separate task preview port.

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
nix shell nixpkgs#nodejs_22 -c npm audit
./scripts/streamdown-acceptance.mjs
./scripts/streamdown-shots.sh
```

The capture script calls Forgerie's `scripts/capture-postures.mjs`; it does not use raw window sizes. Read the PNGs under ignored `verification/local/streamdown/shots/`. Browser results and private history stay under ignored `verification/local/` and must not be committed.
