# Verification and limits

## One fold for agent activity

Reasoning and tool calls before a reply share one fold. Inside it, reasoning reads as text and each tool is one line that opens to its input and output. Before this change, a fold could open only to show another fold: thinking alone sat in a `thinking` fold inside a `thinking` fold, and a run of tools took three levels to reach output. The closed line keeps the failure and stop counts, and now names the tools that ran, which the removed tool group used to show.

| Check | Result |
| --- | --- |
| Automated checks. | `npm run verify` passed the build, lint, and 950 tests. Two new tests (thinking alone, adjacent tools) failed against the previous `Messages.tsx` and `Trace.tsx`. |
| Fixture browser acceptance. | `scripts/trace-acceptance.mjs` passed 32 scenario, theme, and posture combinations. It now also fails if any fold other than a tool line sits inside an activity fold. |
| Visual review. | Open-fold captures were read for unfolded portrait (dark), folded portrait (light), and folded landscape (dark), and the closed capture for unfolded landscape (light). Reasoning text and tool lines sit one level inside the fold, with no inner fold. |

Cost: reasoning text and tool lines now share one indented column, so a long thought between tools takes more scroll than a closed `reasoning` line did. `scripts/real-trace-check.mjs` was updated for the new structure but was not run against a real session. Physical Fold touch acceptance is not done.

## Context use

A thin bar on the input bar's top edge shows how much of the context window the session uses. It turns stronger from 80% and hides until Pi has a reading. See [behavior, verification, and limits](context-use.md).

## Swipe to the session list

Swipe right anywhere on the session to pull the session list in, and left to push it back. The list follows the finger, and a short swipe falls back. Scrolling, sideways-scrolling code, and text selection keep their own drags. See [behavior, verification, and limits](sheet-swipe.md).

## New session

"New session" at the top of the list, N, or Ctrl+Enter opens a titled window after Paperclip's new-task dialog: "Start in [where] with [model]", a large writing area, Attach and Rapidfire chips, and a Start session button. Send starts and opens the session; Rapidfire starts it in the background and keeps the dialog open. See [behavior, verification, and limits](new-session.md).

## Notes on changes

The changes button in the session header opens the session's git diff. Select lines, write a note, and the note waits as a chip in the message box until the next message carries it to the agent. See [behavior, layout, verification, and limits](diff-notes.md).

## Session worktrees

A new session in a Git project starts in a fresh worktree by default. The input bar shows its branch with commits ahead and uncommitted files; the session menu lands or discards it; a landed or discarded conversation stays readable. See [behavior, verification, and limits](session-worktrees.md).

## Archive and next

The archive button in the session header archives the open session with the usual undo offer and opens the next session blocked on you, errored, or unread. With nothing left, the session list opens. See [behavior, verification, and limits](archive-next.md).

## Extension dialogs

Confirm, select, and input dialogs from Pi extensions appear on top of the input bar, oldest first, after any open `ask_user` question. See [behavior, verification, and limits](extension-dialogs.md).

## Session tree

`/tree` and the header's tree button open the session tree in a modal. Pick an entry, then continue the session from it, with an optional summary of the branch it leaves, or fork a new session from it. The modal is a card while the window has room and meets each window edge as that room runs out. See [behavior, layout, verification, and limits](session-tree.md).

## Model and thinking level

The input bar shows the session's model and thinking level. Press it, or send `/model`, to change either one for this session. See [behavior, verification, and limits](model-thinking.md).

## Composer rich editing

The input is a CodeMirror editor again. A complete code fence reads as a highlighted block with its language label, and the draft stays fenced Markdown. Tab indents, lists continue, and undo uses the editor history. See [behavior, costs, and checks](composer-rich-editing.md).

## Composer keyboard

Ctrl+Alt+I focuses the input. Ctrl+Space starts or finishes dictation. Up and Down recall recorded prompts from the draft's first or last drawn line and restore the unsent draft. Hardware Shift+Enter and touch Enter use the legacy modifier evidence rules. Double Escape on an empty idle draft opens the tree or runs Pi's configured action. Escape cancels dictation before session actions. See [behavior, checks, and limits](composer-keyboard.md) and the [legacy audit with remaining gaps](composer-parity-audit.md).

## Sending while working

While the agent works, Queue (or Enter) sends a follow-up and Steer (or Ctrl or Cmd+Shift+Enter) reaches the current response. Pi's queue shows above the composer, and Stop returns it to the draft. See [behavior, verification, and limits](sending-while-working.md).

## Draft protection

Unsent chat text and partial `ask_user` answers survive a session switch and a page reload. They are kept in this browser only, one record per session. See [draft behavior, storage, verification, and limits](drafts.md).

## Skill records

A `/skill:name` command shows as a chip on the user's message, with the typed argument in the bubble. A skill the agent loads shows as its own trace line beside the tool activity. See [record behavior, verification, and limits](skills.md).

## Shell commands

Type `!command` in the one composer to run it in the session's folder, or `!!command` to keep the output out of the agent's context. Output streams into a shell row, and saved commands reload in transcript order. A running command cannot be stopped from this client yet. See [shell behavior, the join contract, verification, and limits](shell.md).

## Session compaction

The one composer supports explicit compaction during idle work or queueing during an active run. Live status and server receipts appear above it. See [compaction behavior, queue clearing, verification, and limits](compaction.md).

## Handoff navigation

A successful `handoff_session` or `spawn_session` call shows its tool line outside the collapsed activity, with an "Open session" button that opens the created session. See [behavior, checks, and limits](handoff-navigation.md).

## Composer mentions

The React MVP supports `@` file discovery and `#` qualified model references in the shared chat and ask composer. See [mention behavior, verification, and limits](mentions.md).

## Image viewing

Tool images and images the assistant returns now show in a gallery below each reply. All images, including user attachments, open in one shared viewer with zoom, pinch, swipe, and next/previous. See [behavior, checks, and limits](images.md).

## Streamdown renderer

The assistant and reasoning renderer now repairs unfinished Markdown with Streamdown while retaining the existing code sheets, copy controls, and image-link policy. See [integration, checks, and bundle cost](streamdown.md).

## Chain-of-thought grouping

The assistant reply now uses the shared `group-chainOfThought` prefix from
[assistant-ui's guide](https://www.assistant-ui.com/docs/guides/chain-of-thought).
Consecutive reasoning and tool parts share one collapsed section. Text ends
that section and stays visible. Nested reasoning and tool disclosures retain
inputs, output, errors, stopped calls, and partial output. The parent shows
failure and stopped counts even while collapsed. Tools without reasoning read
as tool activity, not invented reasoning. No backend, model, or transport code
changed, and no hidden reasoning is requested.

This change stays on the standalone `new-ui-mvp` branch. It does not enter
`main` or restart production services.

| Check | Result |
| --- | --- |
| Automated checks. | `npm run verify` passed the build, TypeScript, lint, and 149 tests. Four new runtime tests cover alternating reasoning/tool parts, text and turn boundaries, parent failure/stopped counts, text-only copy, preliminary output, stable disclosures through updates and authoritative reload, and tools without reasoning. They failed before the presentation change. |
| Read-only real history. | `scripts/real-trace-check.mjs` matched 89 API tool calls to 89 tool lines, including 2 failures, and all 19 thinking parts. No page overflow or browser exception occurred. No prompt was sent. |
| Reconnect and posture transitions. | `scripts/reconnect-acceptance.mjs` preserved the draft, transcript, open outer disclosure, and 80 px scroll position through network recovery at all four Fold postures. It recorded no API mutations or browser exceptions. |
| Fixture browser acceptance. | `scripts/trace-acceptance.mjs` passed 32 scenario/theme/posture combinations. It checked collapsed defaults, lazy output, visible parent failures, native Enter activation, no horizontal overflow, output within the reading column, and 28 px summary rows. Alternating reasoning/tool fixtures produced one outer section with final text outside. |
| Visual review. | The eight running-state PNGs from the canonical posture script were read individually. Closed and expanded trace captures were reviewed in labelled contact sheets. Eight expanded-step captures were also read individually. The composer stayed visible, error counts remained legible, and expanded output stayed within the column at every posture in both themes. |

The presentation retains the homepage's palette, fonts, trace styling, and
container sizing. It adds no dependency or width breakpoint. The quiet
activity line in [Mistral AI](https://mobbin.com/screens/62857b90-6df6-4b6f-ac54-6d3cbcdf75e6)
supported retaining an inline disclosure. The separate thinking panel in
[Google Gemini](https://mobbin.com/screens/19fa8a36-4f95-4ea2-ad23-533e31965ddb)
was not adopted because this task keeps activity beside the reply.

Cost: opening individual reasoning or tool content now takes one more
outer disclosure. Large sessions still render every part. Physical Fold
keyboard and touch acceptance remains unverified. Existing Vite bundle-size
and Picker test `act` warnings remain.

Repeat from this app directory with its dev server running:

```sh
./scripts/trace-acceptance.mjs
SESSION_ID=<existing-idle-session> ./scripts/real-trace-check.mjs
SESSION_ID=<existing-idle-session> ./scripts/reconnect-acceptance.mjs
```

Set `APP_URL` when testing a port other than 8510. Evidence is ignored under
`verification/local/`; real-session content must not enter git.

## Resumable Pi streams

Checked on 2026-09-30 against Forgerie on 8504, with the isolated app on 8511. The user chose to keep the rebuild isolated and land on `new-ui-mvp`, not main. No production service restarted.

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, ESLint, and 155 tests passed after rebasing onto the concurrent chain-of-thought change. Six new tests cover reload reattachment, independent tab readers, covered tool progress/results, and persisted result precedence. Two regression tests failed before the reconciliation fix. |
| Real Pi producer. | `scripts/resume-acceptance.mjs` passed with one scratch prompt, one local producer invocation, and one persisted tool result. Reload resumed the active run. A second tab attached, and closing the first reader did not cancel the producer. The follower received the final answer, and another reload loaded its persisted history. Browser mutations and uncaught exceptions were both zero. The scratch session was archived. |
| Connection-loss regression. | The existing read-only browser check passed at all four postures on an idle session. Five history joins retained the draft, transcript, open disclosure, and scroll position at 80 CSS pixels. Browser mutations and uncaught exceptions were both zero. An initial attempt used the archived scratch session after its temporary workspace was removed; the server correctly refused to open that missing workspace. |
| Fold posture review. | Read all eight captures from the active-run check. The same thread, reasoning/tool lines, composer, and visible Stop control remain available in every posture and theme. No horizontal overflow. No presentation code changed in this task. |

The first live attempt failed because the test read the old document before reload completed. The script now waits for `Page.loadEventFired`. All attempts used their own scratch session. Repeating the successful check after the chain-of-thought rebase brought the verification cost to three model prompts total. The eight rebased captures were also read. Independent review found no reconciliation blocker; its harness cleanup and evidence-wording findings were fixed. A real local HTTP failure check verified that an API cleanup failure remains observable, temporary directories are removed, and the evidence record is refreshed. That check made no model call.

See [the resume contract and limits](resumable-streams.md) for the mapping to the assistant-ui guide and repeat commands. This is Pi transcript recovery, not byte replay or recovery across a sessiond restart. Physical Fold sleep/wake, keyboard, and touch remain unverified.

## Attachments

The assistant-ui attachment adapter uses the unchanged Forgerie server on 8504.
The new UI stays on `new-ui-mvp`. Main and its production services are unchanged.

- The + button supports multiple files. Paste and drop use assistant-ui's input
  and dropzone primitives. Chips show names, errors, remove actions, and image
  previews. The image dialog opens at document level, not inside the composer.
- JPEG, PNG, GIF, and WebP up to 4.5 MiB go to `/prompt` as native images.
  Larger images and other files go to `/attachments` on send, then their saved
  `@path` references go to `/prompt`. The upload uses JSON base64, not multipart.
- Files are capped at 16 MiB each and 16 per message. Combined inline base64 is
  capped at 48 MiB to leave headroom under the server's default 64 MiB body limit.
  A server configured with a lower body limit can still refuse an upload.
  Pi can omit malformed native images. A browser preview does not prove that
  Pi's image decoder accepts the file.
- Attachment-only sends work. During an ask, files use Send message, not the
  text-only answer endpoint. The original text draft returns when the ask closes.
  Unsent files remain in the one composer across ask close and reconnect.
  Slash-command endpoints cannot receive files. A command with attachments is
  refused with a remove-attachments message instead of silently dropping them.
- Upload failure returns the file and text to the composer. A failed prompt keeps
  completed attachments and their references, so manual retry does not upload
  saved files again. New text typed during a failed send is not overwritten.
  A lost acknowledgement can mean Pi already accepted the prompt. The error
  tells the user to check the transcript before sending again. No automatic retry.
- Cancelling attachment preparation aborts the read/upload and prevents a late
  result from sending. Unmounting the session also aborts preparation.
- Removing a chip never deletes a saved workspace file. There is no deletion
  endpoint for uploaded files. Saved files can remain after cancel or refusal.
  Inline images render again from persisted history after reload. General files
  persist as `@path` text, not as download chips. Draft text now survives a
  reload or a session switch, but attachments in an unsent draft do not. See
  [draft protection](drafts.md).

Checks use unit tests, real HTTP/WebSocket test servers, the actual assistant-ui
runtime, and a browser against a scratch Pi session. The browser script verifies
one workspace-file upload, a combined file/image prompt, a live image-only
prompt, the saved bytes, persisted images after reload, all four Fold transitions, image
modal interaction, 24 posture/theme/scenario layouts, and two reduced-size panes.
It rejects API traffic from the network-free fixtures and mutations outside its
scratch session. It archives and deletes the scratch session on exit.

The first native-image run exposed an invalid PNG fixture. Pi's image reader
omitted it. The replacement PNG was checked with Pi's own `resizeImage`, not
only the browser decoder.

The integrated client passed build, TypeScript, ESLint, and 280 tests. The
running HTTPS app passed 30 browser checks with no page exceptions. All 24
chat, ask, and upload-error captures were reviewed in light and dark across the
four Fold viewports. A live image-only regression test caught a dropped user
message; the browser check also caught an empty text bubble after reload. Both
are fixed and covered by tests.

Repeat from this app directory, against the running HTTPS UI:

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
ATTACHMENT_URL=https://zao.hummingbird-lake.ts.net:8510 ./scripts/attachments-acceptance.mjs  # costs three model replies
ATTACHMENT_URL=https://zao.hummingbird-lake.ts.net:8510 ./scripts/attachment-shots.sh
```

Set `ATTACHMENT_URL` for another port, such as the shared server on 8510. Evidence
is under ignored `verification/local/attachments/`. Captures use the main
`capture-postures.mjs` harness. Physical Fold keyboard, file-picker, and gesture
checks remain unverified.

## Realignment with the assistant-ui homepage

Checked on 2026-09-30 against Forgerie on 8504 and the homepage demo source at assistant-ui `90f47502f`. The drift audit, with every change and the differences that remain, is in [`ui-drift-audit.md`](ui-drift-audit.md). Behaviour is unchanged: no store, transcript, reducer, or picker logic changed. The picker's grouping control moved into its "⋯" menu; it is still two taps, and G still switches it.

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, ESLint, and 145 tests passed. |
| Fixture checks. | `visual-acceptance.mjs`, `ask-acceptance.mjs`, and `trace-acceptance.mjs` passed. The 44 px target assertions now measure the hit area (`scripts/lib/hit.mjs`), because controls are drawn at the homepage's 24 to 32 px. |
| Real session, read only. | `acceptance.mjs` and `reconnect-acceptance.mjs` passed against an existing session: 22 messages matched the API after reload, the draft survived all four postures and the reconnect. |
| Picker, real catalog. | `picker-acceptance.mjs` passed read-only. `row-actions-acceptance.mjs` passed with 22 writes to its own scratch session, which it deleted: menu, archive, and undo at all 8 posture and scheme pairs, touch hold, pin, copy, E, undo expiry, restore, and delete. |
| Visual review. | Before, after, and reference captures are in `verification/local/realign/` (ignored). Read: thread, picker sheet, picker with the session menu and the "⋯" menu, undo line, history fixture, tools fixture, ask and long-ask fixtures, across the four postures and both schemes, plus a 1280 × 860 docked capture beside the homepage demo at the same size. |

Two defects were found in review and fixed. A one-question ask showed "1 of 1"; the step row now appears only with more than one question, like the homepage branch picker, or when a command folds the questions. Without the step row, the question layer covered the bar's rounded top corners; it now follows the bar's radius.

Not verified: the physical Fold and its keyboard. Desktop docked layout was checked only at 1280 × 860.

## Session picker, slice 2 (row actions)

Checked on 2026-09-29 against Forgerie on 8504. Every write went to one scratch session that the test created and then deleted for good. No existing session was changed.

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, ESLint, and 145 tests passed. `picker/commands.test.ts` covers the menu for each state, archive disabled while the server would refuse it, E, and the touch hold rule. `picker/rowActions.test.ts` covers the 5 s undo offer, a second archive replacing the first, undo after a delete ("Session was already deleted"), refusals that stay until dismissed, one write per session at a time, and copy. `picker/catalogStore.test.ts` runs the writes against a real HTTP server: the request paths and bodies, a refusal leaves the catalog unchanged, a per-session failure in the bulk delete reply, a confirmed archive that survives an older snapshot, and one view update for a burst of 50 live events. `ui/Picker.test.tsx` covers right click, the visible ⋯, the Menu key, delete asking twice, E, a touch hold whose release does not open the session, and the message line. The race test and the hold test were each seen to fail with their fix removed. |
| Real browser, all four Fold postures, both schemes. | `scripts/row-actions-acceptance.mjs` created a scratch session, then in each of the 8 posture and scheme pairs opened its menu by a real right click, archived it, and pressed Undo. The server state was checked after each step. At folded portrait it then checked: a real touch hold (CDP touch events) opens the menu and does not open the session; pin moves the row to Pinned and the pinned menu is Unpin and Copy; copy reports "Copied workspace path"; E archives the open session; the undo line leaves after 5 s; A shows archived; Restore; Delete asks "Delete for good?", the first press deletes nothing, the second removes the row and the session and closes it. 15 steps, 22 writes, all to the scratch session, no page exceptions. `scripts/picker-acceptance.mjs` (slice 1, read-only) still passes. |
| Visual review. | Read the menu and undo captures for all 8 pairs, plus the pinned menu and the delete confirmation. One defect was fixed: menu labels sat at the top of their 44 px items. At folded landscape (374 px high) the whole menu scrolls into view. |

Behavior:

- The "Open · N · by age" heading is gone (user, 2026-09-29: unnecessary). The age bands follow the state groups directly, and each keeps its own count.
- Menus follow the approved sheet. Open or unread: Pin to top, Archive (E), Copy workspace path. Running (streaming, compacting, or running a command): Archive is shown disabled with "Stop the run first", because the server refuses it. Pinned: Unpin, Copy workspace path, because the server refuses to archive a pin. Archived: Restore, Delete permanently, Copy workspace path. Delete asks twice in place.
- The menu opens by right click, a 500 ms touch hold (10 px travel allowed, ported from the Lit client's `rowPress.ts`), the Menu key or Shift+F10 on the selected row, or the ⋯ shown on the selected, focused, or hovered row. A hold or right click never also opens the session.
- Change from the sheet: the menu opens as a panel under its row, inside the list, not floating over it. The Lit client moved to the same shape after its floating menu was clipped by the transformed sheet. It pushes the rows below it down.
- One message line under the list. It holds the undo offer for 5 s after an archive, "Restored …", "Deleted …", or "Copied workspace path" for 2.5 s, or a server refusal until dismissed. A refused clipboard gives the path in the message instead.
- Archive, restore, and delete send no live event, so the store applies them when the server confirms. A confirmed change also joins a snapshot in flight, so a reconnect cannot undo it on screen.
- Deleting the open session closes it and clears `?session=`. Archiving the open session keeps it open.

Fixed on the way, from slice 1: the idle page spent about 3.7 s of script in every 5 s. The server sends about 170 `status.update` and 170 `activity.update` frames per 5 s while sessions run, and each rebuilt every row. Unchanged events now leave the state as it was, and live events tell the view at most once per 16 ms. Measured with `scripts/idle-cost.mjs`: 0.26 s of script per 5 s, with 2.7 times more frames arriving during that run. This was also why the first acceptance runs hung.

Not in this slice, and the costs:

- "Stop the run" is in the sheet's menu for running sessions but was not agreed for this slice.
- Archive does not move to the next session that needs you (inventory 8.7). Archiving the open session leaves it open.
- The copy fallback for plain HTTP (`document.execCommand`) is untested. The headless run used 127.0.0.1, a secure context. The Fold reaches 8510 over plain HTTP, so it takes the fallback.
- The real Fold is still untested, including the hold timing against the browser's own long press.

Repeat the browser check from this worktree. It prompts one scratch session once, which costs one model reply:

```sh
CHROME_BIN=$(command -v chromium) node scripts/row-actions-acceptance.mjs
```

## Session picker, slice 1 (read-only, one machine)

Checked on 2026-09-29 against Forgerie on 8504 (3,249 sessions: 944 archived, 2,126 agent-spawned, 12 pinned). No prompt was sent and no production service was restarted.

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, ESLint, and 112 tests passed. `picker/board.test.ts` covers state precedence, shorthand time, calendar age bands, location, grouping, J/K order, and the closed-picker mark. `picker/catalogStore.test.ts` runs a real HTTP and WebSocket server: join, asks catalog, live events, events during the snapshot, reconnect with a changed catalog, and an unreadable catalog. `ui/Picker.test.tsx` covers the view in happy-dom and dock rule A at 999 and 1000 px. |
| Real browser, all four Fold postures. | `scripts/picker-acceptance.mjs` opened the app with nothing selected, picked two sessions from the picker, and pressed Back. Every posture used the overlay layout. Each thread took the clicked row's exact title. Back reselected the first row. No page exception and no POST, PUT, or DELETE to `/api`. |
| Visual review. | Captured the empty, open-thread, and open-sheet states in both schemes at all four postures with the main posture script and read them. The sheet is the same element and the same width rule in every posture. Two defects were found and fixed: a hint behind the default-open sheet was cut off, and the closed sheet left a 1 px border on the screen edge. |

Design rules this slice carries, all from review on 2026-09-29:

- No machine chooser. One machine exists today, so machine names never appear.
- Rows carry no chat text and no status words. An unnamed session reads "Untitled session".
- Time is always shorthand. A working row shows how long the current run has lasted, in blue.
- Live work is the agents and terminal icons with a count, hidden at zero.
- Dock rule A: the picker is a sheet below 1000 px of shell width and docks at or above it. `AppShell.tsx` measures the shell, not the viewport. The picker element is mounted once and only its presentation changes, so its scroll position survives a fold or rotate.

Changed beyond the picker: `createSessionStore` takes an optional known session. The picker passes the row it opened, so switching sessions no longer downloads the 2.7 MB machine catalog (about 0.4 s) before the thread can start. A direct `?session=` load still reads the catalog.

Not in this slice, and the costs:

- The "New" button. The header has none, because nothing stands behind it yet. Row actions are slice 2.
- Marking sessions read. Rows show Unread from the server catalog, but opening one does not clear it. The old client on 8504 still clears it.
- Workspace branch names. Locations come from the project list and the path, so a worktree shows its folder name (`live-session-overlay`), not its branch (`feat/live-session-overlay`). Loading every project's workspaces costs 29 requests.
- Many machines. The store reads `/api` only.
- The real Fold keyboard and touch gestures are still untested. There is no swipe to open the sheet.

Pinned cap (user, 2026-09-29): the Pinned group shows three pins, then "Show all 12". The header keeps the full count. A pin that is blocked, errored, working, or unread, and the open session, always show, even past three, so the cap never hides a request. "Show all" resets on every load, like "Show archived". Checked with the live 12 pins at all four postures in both schemes: the Working group now starts on the first screen of the sheet in every posture. Before the cap, 12 pins filled the first screen and pushed Working below the fold.

Repeat the browser check from this worktree:

```sh
CHROME_BIN=$(command -v chromium) node scripts/picker-acceptance.mjs
```

## Ask mode

Checked on 2026-09-29. The standalone client on 8510 uses the unchanged Forgerie backend on 8504. No production service was restarted.

There is one input bar. When the agent calls `ask_user`, the bar gains a question layer on top, and its own input answers the current question. There is never a second input. This replaces the first cut (`0b2bd26f`), where a separate form took the bar's place. The user rejected that cut because the form lost the bar's features. The layout follows the approved mockup in `verification/ask-mockup.html` (`57072007`).

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, ESLint, and 78 tests passed. Store tests use a real HTTP/WebSocket server. They cover rehydration from status, live open and close, supersede order, a late close of a replaced ask, submit and dismiss bodies, a `stale` reply that names a newer ask, a failed send with no retry, reconnect with the ask open, an ask closed while offline, and no send while disconnected. UI tests run the real assistant-ui runtime. They cover one input element in both modes, the draft set aside and put back, answers per question across Back and the step rail, Enter and Shift+Enter, one choice and typed text replacing each other, several choices beside typed text, slash-command routing and its failure, Skip, errors, offline and sending states, and a replacement ask starting blank. |
| Real end to end. | `scripts/real-ask-acceptance.mjs` created its own scratch session and prompted it twice to call `ask_user`. On page load, ask mode came from `status.pendingAsk`, and Skip closed it as `cancelled`. A live `ask.opened` then put the bar into ask mode while a draft was typed. The input and the options sent `[{ id: "color-second", values: ["blue"] }, { id: "note-second", values: [], otherText: "sent from the new UI" }]`, the server recorded `submitted`, and the draft came back. The script archives its scratch session. No existing session was prompted. |
| Fixture checks. | `scripts/ask-acceptance.mjs` passed. The page had one composer input before, during (10 samples through the entry animation), and after the ask. The chat Send button was absent in ask mode. Focus stayed in the input, the draft was set aside, and it returned after Send answers. At the four postures, a 475 × 280 keyboard emulation, and a 280 × 500 pane, in both themes, the page did not overflow, the bar and its input stayed inside the viewport, the question layer used at most 42% of the session height, and every action kept a 44 px target. The fixture made no API requests. `scripts/visual-acceptance.mjs` still passes. |
| Visual review. | All 24 captures in `verification/local/ask-shots/` (`scripts/ask-shots.sh`) were read. The bar has one structure at every posture. Options gain a second column when the bar is wide enough. A shadow at the layer's bottom edge shows when more options are below. |

Behavior:

- The composer's input answers the current question. Enter moves to the next question, and on the last one it sends the answers. Shift+Enter adds a line. Back, the step rail, and Next also move between questions, and each question keeps its answer.
- In a one-choice question, picking an option clears the typed text, and typing replaces the option. What the bar shows is what is sent. In a several-choice question, the options and the typed text are sent together.
- Text that starts with `/` is a command. The questions fold to the step row, a note says the command goes as a chat message, and the action becomes Send message. The server then closes the ask as `answered-in-chat`. A failed send puts the text back.
- The draft from before the ask is set aside when the ask opens and put back when it closes, however it closes. Typed answers of an ask that closed elsewhere are dropped.
- Skip calls `/ask/cancel`. Answers stay in the bar until the server replies. A failed send shows the server's error. Sends are never retried.
- Reconnect keeps ask mode and the answers. Skip and Send wait for the connection.
- Attachments, dictation, and the slash-command list are not in the new UI yet. They are assistant-ui composer features (`addAttachment`, `startDictation`), so when they are added to this bar they work in ask mode too. An attached image will need the same chat routing as a command, because `/ask/submit` carries only text.

Limits:

- On the folded cover screen held sideways (711 × 374), a long question and its detail fill the whole question layer. The options are one scroll away, and the shadow shows that more exists.
- The transcript does not show what was answered. The `pi-web.ask.answers` record is a `custom` message, and the transcript reducer drops `custom` messages.
- The step rail's buttons are 28 px tall. Back and Next give the same navigation with 44 px targets.
- Stop is not offered in ask mode. `ask_user` ends its run, so a run is rarely active while an ask is open.
- The slash-command route was tested in the UI only. The real run did not send a command.
- A session that has not been persisted is missing from `/api/sessions/all`, so the MVP cannot open it by ID.
- Physical Fold keyboard and touch behavior remain unverified.

Repeat the checks from this worktree, with the dev server on 8510:

```sh
./scripts/ask-acceptance.mjs
./scripts/ask-shots.sh
./scripts/real-ask-acceptance.mjs   # prompts a scratch session twice; costs model usage
```

## Automatic reconnect

Checked on 2026-09-29. The standalone client on 8510 uses the unchanged Forgerie backend on 8504. No prompt was sent and no production service was restarted.

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, ESLint, and 58 tests passed. Recovery tests use a real HTTP/WebSocket server. They cover socket and HTTP failures, completion offline, tools and thinking, join buffering, a sequence reset, superseded responses, permanent failures, disposal, and prompt non-retry. |
| Real browser recovery. | `scripts/reconnect-acceptance.mjs` took Chromium offline at each of the four Fold postures. It observed 16 socket attempts and 5 history fetches. The first recovery used the timer alone. Later recoveries used the online signal. Every recovery retained the draft, transcript, and open disclosure. Scroll position remained at 80 CSS pixels. No API mutation or uncaught exception occurred. |
| Real history, read-only. | `scripts/real-trace-check.mjs` matched 13 API tool calls with 13 rendered tool lines, including 1 failure. All 8 thinking parts appeared. No page overflow or exceptions occurred. |
| Fixture checks. | `scripts/visual-acceptance.mjs` passed in both themes, including the new reconnecting and reconnecting-running states. Send and Stop remain disabled during recovery. The fixture made no API requests. |
| Visual review. | All eight reconnecting screenshots in `verification/local/reconnect-shots/` were captured with the main posture script and read. The notice stayed readable and the composer remained inside the viewport. The layout does not change between postures. |

Recovery behavior:

- Unexpected close, socket error, connection timeout, network read failure, and HTTP 5xx trigger automatic retry. Delays start at 500 ms, grow by 1.6, and stop growing at 5 s. Only a complete successful join resets the delay.
- Returning to a visible page, an online event, or a BFCache restore starts a fresh subscription. This also recovers a half-open socket that never reported a close.
- Each connection subscribes before fetching history, stream snapshot, and status. It buffers events during those reads and reconciles them with the snapshot watermark. A new connection never reuses the previous connection's sequence number.
- Forgerie's server does not replay missed frames by cursor. Recovery refetches authoritative state. Persisted message identities survive the reload so existing disclosures do not remount. Unfinished partials can be replaced by authoritative content.
- The thread/runtime stays mounted. The composer retains its draft, but input, Send, and Stop remain disabled until the join succeeds. assistant-ui's `isDisabled` alone did not disable Send in a regression test, so command buttons now explicitly respect it and the binding also sets `isSendDisabled`.
- Invalid consumed event data, malformed successful responses, missing sessions, and HTTP 4xx other than 408/429 stop automatic retry. The error and Reload action remain visible. Prompt and abort requests are never retried automatically because an acknowledgement can be lost after the server accepts a command.

The cost is a full history fetch on every restored connection and every return to the page. Large sessions still have no paging or virtualization. Timers run only when the browser schedules them. These checks use Chromium network and posture emulation, not physical sleep/wake or the Fold's keyboard.

The [Podia disconnected conversation](https://mobbin.com/screens/469ef97c-ed6f-463a-b2df-f3777866bb3e) informed the retained transcript plus one connection notice. This revision reuses the existing notice and header rather than adding a blocking dialog or changing the homepage-derived styling.

Repeat the read-only browser check from this worktree:

```sh
SESSION_ID=<existing-idle-id> nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/reconnect-acceptance.mjs
```

Evidence stays in ignored `verification/local/reconnect-acceptance.json` and `verification/local/reconnect-shots/`. For the main posture script, set `CHROME_BIN` to the Chromium executable if its login-shell discovery cannot see the Nix shell's PATH.

## Tools and reasoning

Checked on 2026-09-29 against Forgerie on port 8504. No prompt was sent for this step.

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, ESLint, and 44 tests passed. Reducer tests cover history, both tool-event orders, late updates, unknown results, interrupted runs, and join-time partials with tools and thinking. UI tests cover joining, disclosures, failures, stopped calls, groups, and the working line. |
| Real history, read-only. | `scripts/real-trace-check.mjs` on session `01a0ef0c…` found 12 tool calls in the API and 12 tool lines on screen. The one failed result showed as `failed`. All 8 thinking parts rendered. No exceptions and no page overflow. |
| Real live run, read-only. | `scripts/live-trace-watch.mjs` watched a running session for 75 s while it ran tools. It received `tool.start` 5, `tool.update` 9, `tool.end` 4, `assistant.thinking.delta` 13, and `message.end` 7. At the end, 118 tool lines matched 118 API tool calls, and the 1 open line matched the 1 API call without a result. |
| Existing acceptance. | `scripts/acceptance.mjs` passed read-only on `01a0ef0c…`: history matched the API, reload did not duplicate, and the draft survived all four postures. |
| Fixture postures. | `scripts/trace-acceptance.mjs` opened reasoning, groups, a failed card, and the last card in 16 captures (2 scenarios × 2 themes × 4 postures). No page overflow, no summary overflow, all output inside the column, and every trace line at least 32 CSS pixels tall. The closed-state captures from `scripts/capture-postures.mjs` were also read. |

The first visual review found two defects. A failed call inside a closed group was invisible, so group lines now count failures and turn red. A `working` line also sat under a running tool, so it now shows only when no tool is running.

Design notes:

- A run's adjacent Pi assistant messages join into one reply through assistant-ui's `concat-content` join. The reply has one copy action, which copies text parts only.
- Tool results attach to their call in the reducer, not through assistant-ui's tool messages. One call id owns one state: `pending`, `running`, `done`, or `interrupted`. This ports the rule from Forgerie commit `1f391cd4`.
- A running tool passes its partial output as a preliminary result. A stopped call gets an empty settled result, so assistant-ui never reads it as awaiting action.
- Trace lines are 32 CSS pixels tall, not 44. This keeps a long run compact and exceeds the 24-pixel WCAG 2.2 AA minimum. It is a judgement, not a measured device result.
- Tool output renders only while its card is open and stops at 16,000 characters, with a count of the characters not shown.

## Homepage UI adaptation

Checked on 2026-09-29. The UI adapts the actual assistant-ui homepage sources at `dabe34fca8a31bf7f8afac89827bf3bf683942e6`, not a new visual design made from unstyled primitives. See [source mapping and licenses](../THIRD_PARTY_NOTICES.md).

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, ESLint, and 26 tests passed. The typecheck includes the fixture entry point. |
| Real history. | The existing session loaded three text messages. The last assistant reply matched the API after Markdown rendering. Reload did not duplicate messages. This revision sent no real prompts. |
| Fold transitions. | The real-session check kept an unsent draft through all four postures. Send remained inside the viewport with a 44 × 44 CSS-pixel hit area. |
| Visual review. | All eight final fixture PNGs in `verification/local/homepage-final/` were captured with the posture script and read back. Both themes retain the same reading column, user bubbles, code sheets, tables, and composer. No page overflow or hidden composer was seen. |
| Additional sizes. | Fixture checks passed at 475 × 280 for reduced-height emulation and 280 × 500 for a narrow pane, in both themes. This is not a physical keyboard test. |
| Presentation behavior. | Real browser clicks and Enter sent through the fixture runtime. Stop, empty, loading, and disconnected states passed. The preview made no API calls. |
| Long content. | Long URLs did not widen the page. Wide code and tables scrolled within their own keyboard-focusable regions. |
| Markdown and clipboard. | Component tests cover formatted replies, streamed updates, safe code highlighting, unknown code languages, image links without remote media loads, and copy success/failure for responses and code. |
| Dependencies. | `npm audit` reported zero vulnerabilities. |

The first visual pass exposed default paragraph margins inside user bubbles. Removing those margins restored the homepage's bubble density. The initial read-only acceptance rerun exposed a verifier race: it counted an older render captured before assistant-ui finished installing history. The verifier now waits for rendered history and uses that current render for the count.

The UI and code formatting increase the production JavaScript from about 632 kB to 980 kB, or from 190 kB to 300 kB after gzip. Vite still reports a bundle-size warning. Font files are served locally. The running app remains the managed Vite server on `[::]:8510`; Forgerie's production services stay unchanged.

## Initial MVP acceptance evidence

Checked on 2026-09-29 against the existing Forgerie server on port 8504. The test selected existing session `01a0ef0c-343b-70d6-902d-d26b3d5b1af9`. It did not create a session or change its model.

| Check | Result |
| --- | --- |
| Initial history. | Five text messages appeared before the successful send. |
| Real prompt. | The browser sent exactly one `{ cwd, text: "hello" }` request during the successful run. |
| Streaming. | The browser received 22 `assistant.delta` frames and showed partial text while Running. |
| Completion. | One user message and one assistant reply appeared. Reload showed seven text messages without duplicates. |
| Browser errors. | No uncaught JavaScript exceptions appeared in the successful run. |
| Automated checks. | Build, TypeScript, ESLint, and 14 tests passed. Tests use a real HTTP/WebSocket server with binary frames. |
| Dependencies. | `npm audit` reported zero vulnerabilities after updating Vitest. |
| Fold transitions. | An unsent draft survived all four emulated postures. Send remained inside the viewport with a 48 CSS-pixel height. |
| Visual review. | All eight light/dark posture PNGs were captured with `scripts/capture-postures.mjs` and read back. No horizontal clipping or hidden composer was seen. |

Two real `hello` prompts were sent in total. The first exposed binary frames forwarded by Forgerie's proxy. The browser originally received a Blob, and JSON parsing failed. Setting `binaryType = "arraybuffer"` and using `TextDecoder` fixed it without async event reordering. The second acceptance run passed. Binary-frame behavior is now covered by the transport test.

A later read-only check loaded three visible text messages and matched the last assistant reply exactly to the API. The source session's returned history changed after the send tests. Its cause was not investigated. This MVP has no branch picker. An initial verifier incorrectly assumed the final visible message was an assistant reply. It now compares the last assistant message, including when history ends with a user message.

Local evidence stays in ignored `verification/local/hello.json`, `verification/local/history.json`, and `verification/local/shots/`. It contains real session content and must not be committed. Managed process `aui-mvp-dev` runs the standalone Vite client. No production service was restarted.

## Repeat acceptance

From this worktree, with Forgerie and the MVP dev server running:

```sh
# Read-only history, reload, and posture-transition checks.
SESSION_ID=<existing-id> nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/acceptance.mjs

# Adds a real hello prompt to the selected session and consumes model usage.
SESSION_ID=<existing-id> nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/acceptance.mjs --send
```

Choose an idle session without an open ask form or dialog. The script expects existing text history and a text reply. Its CDP helpers come from the main Forgerie checkout. `FORGERIE_ROOT` overrides that location if the worktree moves. `APP_URL` overrides the default `http://127.0.0.1:8510/`.

From the main Forgerie checkout, capture each color scheme separately:

```sh
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/capture-postures.mjs \
  --url 'http://127.0.0.1:8510/?session=<existing-id>' \
  --out .worktree/new-ui-mvp/verification/local/shots \
  --label dark --color-scheme dark
```

Repeat with `--label light --color-scheme light`. Read all eight images. The measured CSS viewports are 704 × 783, 932 × 553, 475 × 638, and 711 × 374. These checks use headless device emulation, not the physical Fold or its keyboard. No physical-device acceptance is claimed.

## Contract references

All paths refer to the main Forgerie checkout at `a348db81`.

- `src/server/sessions/sessionRoutes.ts:595-621` requires `cwd` for history/status/snapshot query parameters and prompt/abort JSON bodies. A live history request without `cwd` returned HTTP 400. Prompt returns `{ accepted: true }`, not the model reply.
- `sessionRoutes.ts:549-553` subscribes to events using only the session ID.
- `src/server/sessiond/sessionProxyRoutes.ts` exposes browser routes under `/api` and bridges the socket. Vite preserves this prefix.
- `src/shared/apiTypes.ts:1368-1388` defines history pages and the in-flight stream snapshot. Events carry sequence numbers for join-time reconciliation.
- `src/server/sessions/piSessionService.ts:5630-5675` maps Pi stream events to text deltas and completed messages.

The app owns one session store. Transport effects live in `src/sessionStore.ts`. The pure reducer and message conversion live in `src/transcript.ts`. `src/useThreadMessages.ts` joins a run's messages for assistant-ui. `src/ForgerieSession.tsx` binds that state to assistant-ui. `src/ui/Thread.tsx` composes assistant-ui primitives without reading the Forgerie API.

## UI choices

The supplied homepage design replaces the original Verdana/slate presentation. Public Sans carries the chat text. JetBrains Mono carries code. The palette, 42rem column, right-aligned user bubbles, unboxed replies, bordered composer, and code sheets come from the homepage source. Radius tokens distinguish the thread, controls, and code sheets. Position and shape distinguish user and assistant messages without repeated role labels. Accessible labels retain each message's role.

The [ChatGPT reference](https://mobbin.com/screens/fa707eb9-8ecd-48e1-b94d-647c03a08bc6) also informed the readable reply column and persistent composer. The homepage source determines the visual treatment. A sidebar is not part of this single-session slice.

Gutters and message spacing follow the container. The same layout holds across all postures without device-width breakpoints. The composer is sticky inside the thread's viewport, matching the homepage structure. Code and tables have local scroll regions rather than widening the conversation.

Open `http://127.0.0.1:8510/verification/preview.html` for the separate dev-only fixture entry point. It imports the shipped presentation and uses an in-memory runtime without a network data source. Its scenarios are `history`, `empty`, `loading`, `running`, `disconnected`, `reconnecting`, `reconnecting-running`, `stress`, `tools`, and `tools-running`, selected with `?scenario=<name>`. This HTML entry point is not included in the production build.

From the worktree, run the browser fixture checks with:

```sh
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/visual-acceptance.mjs
```

Tool and reasoning checks. None of them sends a prompt:

```sh
# Opens disclosures in the fixture at every posture and theme, checks layout, saves screenshots.
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/trace-acceptance.mjs
# Compares tool lines, failures, and reasoning with a real session's API history.
SESSION_ID=<existing-id> nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/real-trace-check.mjs
# Samples a session while it runs tools, then compares open and total tool lines with the API.
SESSION_ID=<running-id> WATCH_SECONDS=75 nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/live-trace-watch.mjs
```

Set `CHROME_BIN` if `chromium` is not on `PATH` inside the shell. All three write to ignored `verification/local/`.

Use the existing posture capture command with the fixture URL for reproducible, non-private visual content. Real-session screenshots and API content remain in ignored local evidence.

## Known limits

This is a private standalone MVP on an orphan branch, not a production client replacement. It does not ship in Forgerie's npm package, so no Forgerie Changeset was added.

Text, thinking, and tool calls are converted. Thinking shows as collapsed reasoning. Every tool uses one generic card with its input and text output; there are no custom `edit` diff or `bash` cards yet. Image parts in tool output show as `[image]`. Shell (`!` command) events and skill-read lines are not shown. Assistant text supports Markdown headings, lists, links, tables, and code fences. User messages retain their literal text. Markdown images become links, not remote media requests. Math and diagrams remain text. Ask forms, dialogs, and process cards are excluded. System messages render in full, including very long system prompts. A session waiting for an excluded form can stay Running until answered in the original Forgerie UI.

A closed socket triggers automatic reconnect and authoritative resync. The transcript and draft remain in memory, but commands and input stay disabled during recovery. Permanent contract/session failures still require Reload. The queue workflow covers `/compact` only. There is no branch switching or persisted draft across page reloads. Rotation and reconnect preserve the current draft because they do not remount the app. Physical sleep/wake and keyboard behavior remain unverified.

History loads as one full response. There is no paging or virtualization yet. The production JavaScript bundle is about 998 kB before gzip and 306 kB after gzip. Vite reports its size warning. Stop's HTTP body is tested against the transport contract, but a real model run was not interrupted during acceptance.
