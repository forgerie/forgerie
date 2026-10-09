# Composer mentions

The React MVP uses assistant-ui's [mention primitives](https://www.assistant-ui.com/docs/guides/mentions) from the installed `@assistant-ui/react` 0.15.22. This change stays on `new-ui-mvp`. It does not replace the production client or change the server.

| Trigger | Discovery and insertion |
| --- | --- |
| `@` | Search tracked files in the selected session's registered workspace. Insert `@path`, with quotes when the path contains spaces. |
| `@ ` or `!@` | Search all files. Keep the prefix while navigating directories. Insert completed files with the existing `@path` syntax. |
| `#` | Search available model names and qualified IDs for the selected session. Insert `#provider/model-id`. Selection does not change the active model. |

`mentionSource.ts` owns validated, cancellable discovery through the existing file and model GET APIs. Workspace resolution requires an exact registered path, including a registered worktree outside its project root. A missing workspace produces an error rather than searching another directory.

`MentionPopover.tsx` uses assistant-ui for trigger detection, insertion, ARIA, and keyboard selection. Requests wait 60 ms and return at most 12 suggestions. Query, session, and ask changes cancel obsolete requests. Loading, empty results, and errors remain visible. Arrow keys select a result. Enter or Tab inserts it. Escape closes the list without deleting text. Mention selection takes precedence over ask navigation. Chat and ask mode share the same composer input.

The popup uses the composer's width and the available visual viewport height. It renders into `document.body` so the transcript cannot clip it. Long paths wrap, and the list scrolls without changing its structure at a posture boundary. Selection restores the native caret, including inside quoted directories and before the remainder of a draft.

## Evidence

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, ESLint, and 198 unit tests passed after rebasing onto the concurrent chain-of-thought, stream-recovery, slash-command, and Streamdown changes. HTTP tests cover exact workspace selection, encoded queries, scopes, limits, model filtering, refusals, malformed responses, and cancellation. Component tests use the real assistant-ui runtime. The existing slash-command browser script also passed all 12 posture and theme combinations, including keyboard completion and ask precedence. |
| Browser fixture. | `scripts/mentions-acceptance.mjs` passed 24 geometry and interaction cases: files and models at four Fold postures, a 475 × 280 reduced-height viewport, and a 280 × 500 pane, in both themes. The draft survived every viewport change. Popups stayed inside the viewport. The last keyboard-selected result stayed visible. Insertion did not send chat or advance an ask. Slash completion and file completion inside `/review @src` coexist without sending. No API request or uncaught page exception occurred in the fixture. |
| Live discovery, read only. | The same script opened an existing session against the backend on 8504. File discovery returned `src/`. Model discovery returned `cliproxyapi/gemini-3.8-flash-high`, and selection inserted the qualified reference. All observed API requests used GET. No prompt was sent and no model was changed. |
| Visual review. | Read all 24 captures in `verification/local/mentions-shots/`: file suggestions, model suggestions, and file suggestions in ask mode, across four postures and both themes. Labels wrap inside the list, the input and actions remain visible, and no posture changes the popup structure. In short postures the popup covers the question while open; dismissing it exposes the question again. After the rebase, all 24 captures were regenerated and reviewed in six labelled contact sheets. |

The first browser run found an off-screen popup. Positioning now runs when the portal panel mounts and when its anchor or visual viewport changes. Later failures came from broad test selectors: assistant-ui adds a hidden sizing textarea, and the session picker also has options. Acceptance now targets the composer and mention options explicitly.

## Limits and cost

Physical Fold keyboard, touch selection, fold transitions, and screen-reader behavior remain unverified. Reduced-height Chromium emulation is not a keyboard test. The server has no paging contract for these suggestions; only the first 12 matching entries appear. Model discovery fetches the available list for each settled query. First file discovery reads projects and workspaces until it finds the session's exact workspace.

The popup uses unstable assistant-ui APIs. A future SDK upgrade must repeat keyboard, insertion, and ARIA tests. No Changeset is included because the orphan MVP is not part of the published package. No production service restart is required or performed.

## Repeat

Run from the React MVP worktree with its dev server available:

```sh
nix shell nixpkgs#nodejs_24 -c npm run verify
APP_URL=http://127.0.0.1:8510/ nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node scripts/mentions-acceptance.mjs
APP_URL=http://127.0.0.1:8510/ SESSION_ID=<existing-session-id> nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node scripts/mentions-acceptance.mjs
APP_URL=http://127.0.0.1:8510/ nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node scripts/mentions-shots.mjs
```

The live check sends no prompt and changes no model. Reports and captures remain ignored under `verification/local/`.
