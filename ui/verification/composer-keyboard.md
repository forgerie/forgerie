# Composer keyboard backport

The new client restores prompt recall, input focus, dictation keys, and the applicable Android modifier handling. It keeps the current queue and steer controls. No CSS, layout, or backend API changed.

## Behavior

| Key or input | Result |
| --- | --- |
| Ctrl+Alt+I | Focuses the foreground composer without replacing its draft. This also works in the new-session dialog. |
| Ctrl+Space | Starts or finishes dictation through the existing buttons. It does not send the result. Search fields, another editor, IME composition, repeated keys, and background dialogs do not trigger it. |
| Up at the start of the text | Recalls the newest user prompt, then older prompts. Suggestions take the key first. Ask answers and extension input answers do not recall chat prompts. |
| Down at the end of recalled text | Moves toward newer prompts, then restores the exact unsent draft and caret. Editing a recalled prompt ends browsing. |
| Enter in chat | Sends, queues, or runs the current special action. Touch autocapitalization's implicit Shift does not turn this into a newline. |
| Hardware Shift+Enter | Inserts a newline. A held Shift still counts when an Android IME drops the Enter modifier. Keyup, blur, and consumption clear the held state. |
| Ctrl or Cmd+Shift+Enter while working | Steers. A Ctrl or Cmd chord counts as hardware modifier evidence. |
| Enter in a new session | Inserts a newline. Ctrl or Cmd+Enter still starts the session. |

The shared controller is `src/ui/useComposerKeyboard.ts`. `src/promptHistory.ts` owns recall order and draft restoration. Ordinary sends still use the SDK form action. The controller normalizes modifiers before suggestions, shell, compaction, asks, dialogs, queue, steer, and ordinary chat routing.

History reads up to 100 user prompts from the thread. It skips empty prompts and adjacent duplicates. Skill records carry their expanded prompt in SDK metadata so recall does not send only the displayed argument. Recall does not reconstruct attachments.

The legacy sources checked were `main:src/client/src/components/ComposerDraft.ts`, `main:src/client/src/promptHistory.ts`, `main:src/client/src/promptEnterBehavior.ts`, and `main:src/client/src/plugins/core/actions.ts`. Ctrl+Space was an earlier legacy default, added in `582e5433`; current `main` exposes the dictation action without a default key.

## Verification

| Check | Result |
| --- | --- |
| `npm run verify` | Build, TypeScript, ESLint, and 922 tests pass. |
| `scripts/composer-keyboard-acceptance.mjs` | 12 theme and size combinations pass with real Chromium key input. All four Fold postures, a 475 × 280 height budget, and a 280 × 500 pane are covered. Recall state survives four posture changes. No API request or browser exception occurs. |
| Existing browser fixtures | Queue passes 60 combinations, mentions 24, ask 24, dialogs 60, shell 36, new session 42, and slash commands 12. |
| Visual review | All eight light and dark posture captures were read. The recalled prompt and the composer controls remain readable and inside the window. |
| Physical acceptance | `adb devices` listed no device. Physical Fold keyboard, microphone, touch, folding, and rotation remain unverified. |

The queue browser script now sends a physical Shift keydown before Shift+Enter. A modifier flag alone is also the touch-autocapitalization sequence under test.

Evidence remains local in `verification/local/composer-keyboard/acceptance.json`, `/tmp/forgerie-composer-keyboard-verify.log`, and `/tmp/forgerie-composer-keyboard-shots/`. Repeat the network-free keyboard check with:

```sh
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/composer-keyboard-acceptance.mjs
```

## Costs and limits

Textarea recall uses document ends instead of CodeMirror's rendered-line coordinates. This protects wrapped-line caret movement, but Down requires reaching the end of recalled text. History contains recorded user prompts, not an independent log of shell commands or rejected sends. A complete loss of hardware modifier evidence cannot be distinguished from touch input.

The separate legacy keyboard-free voice dialog and configurable app-wide shortcut settings are not part of this backport. Existing bundle warnings remain.

This change stays on `new-ui-mvp`. The running Vite preview on port 8510 served the new code during acceptance. Production on port 8504 was not changed or restarted.
