# Session tree

Type `/tree` and send it, or press the tree button in the session header. The session tree opens in a modal. Pick an entry, then do one of these:

| Action | Result |
| --- | --- |
| Continue from here | Pi moves this session to the entry. Later entries stay in the tree as another branch. If the entry is a user message, its text returns to the message box. Otherwise the message box becomes empty. |
| Summarize, then Continue | Pi also writes a summary of the branch the session leaves. The optional focus text steers that summary. Summaries use the model and cost model usage. |
| Fork | Pi starts a new session file from the history up to the entry. A user message forks from before itself and becomes the new session's draft. The client opens the new session. The original session does not change. |

The tree opens on your own messages. Choose No tools, Conversation, Labeled, or All to see more. Search matches every word you type, in the label, the kind, and the summary. A lens or search change keeps the entry you picked: the selection moves to its nearest visible ancestor, and comes back when the entry is visible again. Arrow keys move and fold, Home and End jump, and Enter continues. The copy button in the header copies the selected entry's text.

Rows that the move would take off the active path fade while you choose. The current entry shows "Current" in blue. A filled dot marks the active path. Rails and a caret appear only at real forks.

## Layout

The modal is a centered card while the window has room around it. As that room runs out, each axis gives up its own margin, and the card meets that edge. Width and height change independently, and no width or height flips the layout. The old Lit navigator changes to a full-screen sheet at a 760 px container width. That width is inside the Fold posture range, so this client does not copy it.

The header and the action row stay in place. Only the tree scrolls while the window has height. In a very short window, the tree keeps two rows and the area between the header and the actions scrolls as one. This keeps the summary focus field reachable with the keyboard open.

## Contract and limits

The client uses the existing `/tree/navigate`, `/tree/fork`, and `/abort` endpoints. The backend and the Lit client do not change.

- Each action sends `expectedLeafId`, the leaf the modal showed. If the session moved since then, Pi refuses the action, and the modal shows Pi's reason. Close the modal and run `/tree` again.
- The client never retries an action. If the reply is lost, the modal says that the session may have changed.
- After a continue, the client reloads the history of the same session. The connection stays "Connected" during the reload.
- While an action runs, every action and the close button are disabled. Escape stops a running summary. Escape does nothing during a plain continue or a fork.
- Pi refuses `/tree` while the session works, so the header button is disabled during a run.
- Continue replaces any unsent text in the message box with the entry's text, or clears it. The old client does the same.
- In the User lens the current entry is often an assistant reply, which the lens hides. The selection then starts on the last user message before it, and no row shows "Current". Choose All to see it.
- There is no double-Escape shortcut yet. The old client opens the tree on a double Escape in the composer.

## Verification

Run from this app directory with the dev server running. Set `APP_URL` if the server uses another port.

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/tree-acceptance.mjs
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/tree-shots.mjs
SESSION_ID=<idle session with two user messages> \
  nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/real-tree-check.mjs
```

`tree-acceptance.mjs` uses the network-free `verification/tree-preview.html`. It checks five states in both color schemes at the four Fold postures, a 475 × 280 keyboard window, and a 280 × 500 pane. Every drawn control must sit inside the window, every hit area must be at least 40 px tall, and every row at least 44 px tall. It also checks that the lens, search, and selection survive fold and rotation, and the keyboard flow.

`real-tree-check.mjs` never moves `SESSION_ID`. It forks the session before its second user message, continues the fork from the first user message, checks the returned text and the reloaded history, checks that the original history is unchanged, and archives the fork. It sends no prompt.

| Check | Result (2026-10-05) |
| --- | --- |
| Unit and component tests | Build, lint, and 490 tests pass. 49 tests are new: the model port (22), outcomes and presentation (7), the store (6), the modal (11), and the session view (3). |
| Fixture browser check | 60 combinations pass. State survives four posture changes. Keyboard flow passes. No API write and no browser error. |
| Posture captures | 40 captures (five states, two schemes, four postures). I read the captures for every state at folded portrait and folded landscape, and spot-checked the unfolded postures. |
| Real session | Session `01a0d563…` (35 history entries, 4 user messages). The fork held 10 entries and its draft was the second message. Continue in the fork returned the first message and emptied the transcript. The original still held 35 entries. The fork was archived. |
| Physical Fold | Not tested. |
