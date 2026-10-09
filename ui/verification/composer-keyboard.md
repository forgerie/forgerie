# Composer keyboard backport

The new client restores prompt recall, input focus, dictation keys, Escape routes, and the applicable Android modifier handling. It keeps the current queue and steer controls. No CSS, layout, or server API changed. The [legacy audit](composer-parity-audit.md) records the broader scan and the missing capabilities. This backport is not full parity.

## Behavior

| Key or input | Result |
| --- | --- |
| Ctrl+Alt+I | Focuses the foreground composer without replacing its draft. This also works in the new-session dialog. |
| Ctrl+Space | Starts or finishes dictation through the existing buttons. It does not send the result. Search fields, another editor, IME composition, repeated keys, and background dialogs do not trigger it. |
| Escape during dictation | Cancels capture or pending transcription without stopping the agent or changing the draft. Late transcription cannot replace the draft. |
| Escape in chat | Closes suggestions first. Clears a pending shell draft. Stops active work only from an empty draft, including compaction and queued work. |
| Double Escape with an empty idle draft | Runs `/tree` by default, or `/fork` when Pi configures it. `none` disables the gesture. Presses must be genuine and less than 500 ms apart. Ask/input answers and attachments cannot open the tree. |
| Meta+Enter in chat | Does not send or select a suggestion. Cmd+Shift+Enter still steers. |
| Up at the start of the text | Recalls the newest user prompt, then older prompts. Suggestions take the key first. Ask answers and extension input answers do not recall chat prompts. |
| Down on the last drawn line of recalled text | Moves toward newer prompts, then restores the exact unsent draft and caret. Editing a recalled prompt ends browsing. |
| Enter in chat | Sends, queues, or runs the current special action. Touch autocapitalization's implicit Shift does not turn this into a newline. |
| Hardware Shift+Enter | Inserts a newline. A held Shift still counts when an Android IME drops the Enter modifier. Keyup, blur, and consumption clear the held state. |
| Ctrl or Cmd+Shift+Enter while working | Steers. A Ctrl or Cmd chord counts as hardware modifier evidence. |
| Enter in a new session | Inserts a newline. Ctrl or Cmd+Enter still starts the session. |

The shared controller is `src/ui/useComposerKeyboard.ts`. `src/promptHistory.ts` owns recall order and draft restoration. Ordinary sends still use the SDK form action. The controller normalizes modifiers before suggestions, shell, compaction, asks, dialogs, queue, steer, and ordinary chat routing.

History reads up to 100 user prompts from the thread. It skips empty prompts and adjacent duplicates. Skill records carry their expanded prompt in SDK metadata so recall does not send only the displayed argument. Recall does not reconstruct attachments.

The first scan checked selected editor and core-action files. The follow-up also checked `PromptEditor`, `PiWebApp`, the new-session and voice hosts, completion/runtime helpers, rich editing, and CodeMirror's keymaps. The [audit](composer-parity-audit.md) pins the source commit and links the 25-file candidate inventory. Ctrl+Space was an earlier legacy default, added in `582e5433`; current `main` exposes the dictation action without a default key.

## Verification

| Check | Result |
| --- | --- |
| `npm run verify` | Build, TypeScript, ESLint, and 949 tests in 98 files pass. |
| `scripts/composer-keyboard-acceptance.mjs` | 12 keyboard combinations and 12 tree combinations pass with real Chromium key input. All four Fold postures, a 475 × 280 height budget, and a 280 × 500 pane are covered. Recall state survives four posture changes. No API request or browser exception occurs. |
| Session integration | `ForgerieSession.keyboard.test.tsx` exercises real local HTTP/WebSocket endpoints for default tree, fork, none, compaction Stop, queued-only Stop, and tree refusal/retry. |
| Existing browser fixtures | Queue passes 60 combinations, tree 60, mentions 24, ask 24, dialogs 60, shell 36, new session 42, and slash commands 12. Dictation recording passes the four postures in both themes. |
| Visual review | The initial eight composer captures and the follow-up eight tree captures were read. Controls remain readable and inside the window. |
| Physical acceptance | `adb devices` listed no device. Physical Fold keyboard, microphone, touch, folding, and rotation remain unverified. |

The queue browser script now sends a physical Shift keydown before Shift+Enter. A modifier flag alone is also the touch-autocapitalization sequence under test.

Evidence remains local in `verification/local/composer-keyboard/acceptance.json`, `/tmp/forgerie-composer-audit-*.log`, and `/tmp/forgerie-composer-audit-shots/`. Initial composer captures remain in `/tmp/forgerie-composer-keyboard-shots/`. Repeat the network-free keyboard check with:

```sh
nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node scripts/composer-keyboard-acceptance.mjs
```

## Costs and limits

Recall originally used textarea document ends. Since the input became CodeMirror again, it uses the legacy drawn-line rule; see [composer rich editing](composer-rich-editing.md). History contains recorded user prompts, not an independent log of shell commands or rejected sends. A complete loss of hardware modifier evidence cannot be distinguished from touch input.

Rich code editing and CodeMirror's keymaps are restored separately; see [composer rich editing](composer-rich-editing.md). Selection-aware dictation, tap/hold voice capture, retained-audio retry, the voice-first dialog, and configurable app-wide shortcuts remain missing. See the [audit](composer-parity-audit.md) for each difference and the parent shortcuts. Existing bundle warnings remain.

This change stays on `new-ui-mvp`. The running Vite preview on port 8510 served the new code during acceptance. Production on port 8504 was not changed or restarted.
