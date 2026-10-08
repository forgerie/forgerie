# Legacy composer audit

Double Escape was missing from the first backport. The first scan covered selected editor files, not the parent and global handlers. Passing the new tests did not establish legacy parity.

This follow-up restores the missed Escape routes and the chat Meta+Enter guard. Full parity remains incomplete.

## Sources and scope

The legacy reference is `7350dbb3504eb9f3a9fdac9619cdd40a18d86f8e` on `main`. The new-client baseline is `df763c2d` on `new-ui-mvp`.

The [candidate inventory](composer-legacy-test-inventory.txt) contains matching test and behavior lines from 25 legacy test files. It guides the scan. It is not a list of passing new-client tests.

The implementation scan included these legacy sources under `src/client/src/`:

- `components/PromptEditor.ts`, `components/ComposerDraft.ts`, and `components/NewSessionComposer.ts` define the shared editor and its hosts.
- `components/VoiceComposerDialog.ts`, `components/composerDraftDictation.ts`, and `components/composerCodeBlock.ts` define voice ownership and rich code editing.
- `components/PiWebApp.ts`, `plugins/core/actions.ts`, and `keyboardShortcuts.ts` define parent handlers, action dispatch, and shortcut configuration.
- `composerRuntime.ts`, `promptCompletions.ts`, `promptHistory.ts`, and `promptEnterBehavior.ts` define discovery, recall, and Enter behavior.
- CodeMirror's installed `defaultKeymap`, `historyKeymap`, and `indentWithTab` define editing capabilities that custom handler scans alone miss.

The comparison covers composer capabilities and their parent/global entry points. It does not audit every legacy workspace feature. Source findings below distinguish restored behavior, existing behavior, deliberate changes, missing capabilities, and checks that remain open.

## Restored keyboard routes

| Legacy capability | New client and evidence |
| --- | --- |
| Ctrl+Alt+I focuses the editor. | Restored in the foreground chat or new-session composer. Modal and other-editor guards have regressions. |
| Prompt recall preserves the unsent draft. | Restored with a 100-entry limit, blank and adjacent duplicate filtering, skill prompt reconstruction, and caret restoration. |
| Android implicit Shift must not turn Enter into a newline. | Restored with physical Shift tracking and IME guards. Chromium and synthetic events pass. Physical acceptance remains open. |
| Plain Meta+Enter must not send chat. | Restored before suggestions and every chat route. Cmd+Shift+Enter still steers. This does not reproduce CodeMirror's macOS blank-line command. |
| Suggestions own Escape before session actions. | Preserved with a regression. Closing suggestions does not arm the double-Escape gesture. |
| Escape clears a pending shell draft. | Restored. Clearing `!pwd` does not count as the first empty Escape. |
| Escape stops active work. | Restored for an empty draft during streaming, compaction, or queued work. The new client's protection for typed drafts remains. |
| Two empty Escape presses within 500 ms run Pi's configured idle action. | Restored. Default `tree`, configured `fork`, and `none` have real HTTP/WebSocket integration tests. Repeats, modifiers, edits, mode changes, blur, composition, and binding changes cannot carry a gesture forward. |
| The shortcut uses the real tree/fork command path. | Verified through `/commands/run`. A fork opens the returned session and draft. Failed tree reads remain visible and retryable. |
| Dictation owns Escape while it records or transcribes. | Restored through the existing Cancel control before composer Stop/tree handlers. Cancellation preserves text and ignores late transcription. |
| A dictation action can have a keyboard binding. | Ctrl+Space uses the existing Start/Stop controls. Current legacy `main` has no default dictation key. Ctrl+Space was an earlier default in `582e5433`. |

The visible tree button shares the command path. The `none` setting disables the shortcut, not the button.

## Existing capabilities checked

These families map the remaining candidate tests to current code and fixture checks. They do not assert identical UI or every legacy timing detail.

| Legacy test family | Current implementation and check |
| --- | --- |
| `ComposerDraft.test.ts` and `PromptEditor.draft.test.ts` | SDK text and attachment state, `chatDraft.ts`, and `draftStore.ts` retain chat drafts. New-session recovery uses `NewSession.tsx`, held files, and the launch store. Attachment and new-session tests pass. Exact CodeMirror transaction parity is absent. |
| `PromptEditor.actions.test.ts`, `capabilities.test.ts`, `preSession.test.ts`, and `runtimeControls.test.ts` | Attachment capture, model/thinking choice, Stop, tree, archive, and new-session actions remain. Archive and new-session actions live outside the editor rail. The current API bindings enforce availability. |
| `PromptEditor.modelCompletion.test.ts`, `modelThinking.test.ts`, and `composerRuntime.test.ts` | `@` files, `#` models, `/` commands, model choice, and thinking choice remain. Current mention, command, and model tests cover discovery and refusal. Mention and slash browser checks pass. |
| `ComposerDraft` completion tests | Arrow selection, Enter/Tab insertion, Escape dismissal, loading/error states, stale-request protection, and caret restoration remain through SDK triggers and the current discovery sources. Mention and slash browser checks pass. |
| `PromptEditor.rail.test.ts` | Enter queues while working. Ctrl/Cmd+Shift+Enter steers. Stop and Clear preserve their current draft/queue rules. The current client has separate Queue and Steer controls instead of the legacy held-Queue disclosure. Queue browser checks pass. |
| `NewSessionComposer.test.ts` and `agentChoices.test.ts` | Destination, first prompt, attachments, model/thinking, command validation, Rapidfire, refusal, and draft recovery remain. The current new-session dialog and launch store own them. New-session browser checks pass. |
| `PromptEditor.island.test.ts`, `restingState.test.ts`, `reveal.test.ts`, and `summonedChrome.test.ts` | The old island styling and resting/reveal layout are not copied. The current composer keeps its existing controls and layout. Eight tree captures across the Fold posture matrix were reviewed in both themes. |
| Parent session actions | Ctrl/Cmd+Enter opens a new session outside text fields. Shift adds Rapidfire. Picker-scoped J/K, arrows, N, and E remain through `shortcuts.ts`, `Picker.tsx`, and `picker/commands.ts`. This is not a port of the legacy configurable dispatcher. |

## Missing capabilities and behavior differences

| Capability or rule | Status and cost |
| --- | --- |
| Rich fenced-code blocks | Missing. Typed and pasted fences stay plain text. Language highlighting, hidden fence protection, code/prose navigation, and atomic block undo are absent. Legacy `ComposerDraft.codeBlock.test.ts` is not satisfied. |
| CodeMirror editing commands | Missing. Tab/Shift+Tab indentation, Markdown list continuation, line move/copy, multiple cursors, syntax selection, bracket matching, comment commands, and selection undo/redo are not implemented by the textarea. Tab without suggestions moves focus. Native text editing is not an equivalent keymap. |
| Dictation replaces the selected range in one undoable edit. | Missing. The SDK appends transcription to its captured baseline text. The current code does not preserve the selected range or use CodeMirror's transaction history. |
| Tap automatic endpoint completion and hold-to-talk | Missing. Current dictation uses explicit Start and Stop. It does not port the legacy microphone's tap/hold state machine or Smart Turn completion. |
| Retained-audio retry, voice level, and elapsed readouts | Missing. Current dictation reports Starting, Listening, Transcribing, or failure. A failed turn cannot use the legacy retained-audio Retry/Discard workflow. |
| Voice-first dialog and Ctrl+Alt+Enter "Speak to Session" | Missing. `VoiceComposerDialog.test.ts` covers automatic listening, no keyboard focus, countdown sending, cancellation, and background recovery. Ordinary composer dictation does not reproduce this workflow. |
| Configurable app-wide shortcuts | Missing. The current client has fixed shortcuts, not the legacy action registry, shortcut overrides, conflict handling, or shortcut settings. |
| Global palette and panel shortcuts | Missing. Ctrl+Shift+P, Ctrl+comma, Ctrl+K Ctrl+S, Ctrl+Shift+E, Ctrl+Shift+G, and Ctrl+backtick are not restored by this work. Visible settings and navigation are not proof of their keyboard behavior. |
| Legacy plugin prompt insertion/focus contract | Not ported as that contract. The candidate `PiWebApp.pluginPromptEditor.test.ts` routes plugin actions through the old lock-aware editor. This audit does not establish equivalent new-client plugin behavior. |
| History boundary | Changed. Legacy CodeMirror uses rendered-line positions. The textarea uses document ends. This avoids stealing wrapped-line cursor movement but requires reaching the end before leaving a multiline recall. |
| History source | Changed. Recall projects recorded user messages. Legacy also adds an accepted send immediately. Rejected sends and independent shell-command history are not reconstructed. |
| Escape with typed text during active work | Deliberate retention of the current policy. Legacy stops active work with a typed draft. Here Escape does not stop until the draft is empty. |
| Enter in a new-session dialog | Deliberate retention of the current policy. Plain Enter inserts a newline. Ctrl/Cmd+Enter starts the session. Legacy shared-editor submission rules differ. |
| New-session Close and Rapidfire destination | Deliberate retention of the current policy. Close keeps the draft. Rapidfire follows the selected destination instead of the old current-workspace lock. See `new-session.md`. |
| Abort during shell execution | Backend limitation. The current Stop route calls session abort, not `abortBash()`. Do not claim Escape terminates the shell process. See `shell.md`. |
| Physical Android modifiers, native undo, and accessibility | Unverified on the acceptance device. No ADB device is attached. Headless Chromium cannot prove hardware/IME sequences, microphone behavior, or screen-reader behavior. |

Restoring rich editing or the voice-first workflow requires separate implementation work. Reproducing CodeMirror with textarea-specific handlers adds ownership cost and still does not supply its transaction model.

## Verification of this follow-up

| Check | Result |
| --- | --- |
| `npm run verify` | Build, TypeScript, ESLint, and 949 tests in 98 files pass. |
| Keyboard browser script | 12 keyboard combinations, 12 double-Escape tree combinations, and four recall posture changes pass. All four Fold postures and short/narrow panes run in light and dark. No API request or browser exception occurs in previews. |
| Existing fixture regressions | Queue 60, tree 60, mentions 24, ask 24, dialogs 60, shell 36, new session 42, and slash 12 pass. Dictation recording runs across four postures in both themes. |
| Visual review | All eight tree captures were read. Close, search, filters, and footer actions remain inside the window. The short landscape tree scrolls without replacing its layout. |
| Production and physical target | Production on port 8504 was not changed. Acceptance used the Vite preview on 8510 and local integration endpoints. Physical Fold acceptance remains blocked by the missing ADB device. |

Logs are local at `/tmp/forgerie-composer-audit-*.log`. Tree captures are at `/tmp/forgerie-composer-audit-shots/`. Keyboard results are at `verification/local/composer-keyboard/acceptance.json`.
