# Pi slash commands

The standalone MVP uses assistant-ui 0.15.22's trigger popover and slash-command adapter. No dependency change is required.

## Behavior

Type `/` at the start of the composer. Search matches names and descriptions. Arrow keys, Enter, Tab, or a pointer select a command. Selection inserts plain `/command ` text. It does not execute the command. Add arguments and use Send to execute it. Escape closes the picker without deleting text.

This deliberately differs from the guide's immediate-action example. Pi commands can mutate sessions and often require arguments. Explicit Send prevents selection from running `/compact` or `/clone` unintentionally. Directive chips never reach Pi.

Discovery uses `GET /api/sessions/:id/commands?cwd=...`. Execution uses `POST /api/sessions/:id/commands/run` with `cwd` and the original text. Follow-up choices use `/commands/respond` with the exact request and option IDs. Mutations never retry automatically. Errors preserve the draft. Discovery failure shows Retry without breaking the live session. Reconnect and `/reload` refresh discovery.

The same picker works in ask mode. Palette navigation has Enter precedence over answering the question. Non-prompt commands do not necessarily close an ask; Pi owns that decision. Short rename, fork, and clone confirmations show as toasts. Detailed output and follow-up choices stay above the composer. Neither adds a transcript message. A fork or clone result selects its returned session and restores a returned draft. `/tree` opens the [session tree](session-tree.md) instead of a command result.

## Checks

Run from this app directory:

```sh
nix shell nixpkgs#nodejs_24 -c npm run verify
APP_URL=http://127.0.0.1:8510 LIVE_SESSION=<idle-session-id> \
  nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node scripts/slash-acceptance.mjs
```

Omit `LIVE_SESSION` for fixture-only acceptance. The live check executes only `/session`, not a model prompt. Fixture rendering uses injected command data, not network interception.

Use the parent repository's `scripts/capture-postures.mjs` for captures. The fixture URL is `/verification/preview.html?scenario=slash-capture`. Add `--press arrowright` to activate detection after the fixture seeds `/`. Set `CHROME_BIN` to the Chromium executable if the script's login-shell lookup cannot see the Nix shell path.

Verified before landing:

| Check | Result |
|---|---|
| Build, lint, unit tests | Passed after rebasing over concurrent MVP fixes; 170 tests across 17 files. |
| Browser interaction | Keyboard completion, explicit confirmation, highlighted-row scrolling, and ask-mode precedence passed. |
| Fold matrix | All four postures in both schemes passed geometry and draft-preservation checks. Eight captures were read and reviewed. |
| Additional container sizes | 280×500 and a 475×280 keyboard-height budget passed in both schemes. |
| Live Pi endpoint | `/session` ran through `/commands/run`; no `/prompt` request occurred. The session statistics rendered. |

Local evidence is in `verification/local/slash/acceptance.json` and `/tmp/aui-slash-shots/`. These paths are not committed. Physical Fold keyboard and touch validation remains unverified. Keyboard-height emulation is not a physical keyboard check.

Build warnings remain for the large JS chunk and upstream Zod annotation comments. This change does not resolve them. The app remains an orphan-branch MVP, not an npm release; no main deployment or Changeset is involved.

## Command confirmation fix, 2026-10-09

Confirmations use the existing `.picker-toast` presentation, centred below the header at the reading-column width. They dismiss after the existing 2.5-second information interval. Hover or keyboard focus pauses the timer. A new confirmation starts a fresh timer, including repeated text. The toast does not move the composer or take focus. Long names scroll within a height budget, with the close action outside the scroll region. Detailed output is keyboard-scrollable.

From the repository root, run `APP_URL=http://127.0.0.1:5173 nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node ui/scripts/command-feedback-acceptance.mjs`.

Verified with 48 browser layout cases: four Fold postures plus two constrained sizes, both themes, and four feedback states. Drafts survive four posture transitions. Manual dismissal, hover pause, expiry, choice confirmation, and an extreme name also pass. Nine Caliper states across four postures render without errors or spill; both image samples were reviewed. The two folded-landscape panel states retain incomplete contrast audits for scroll-clipped text. There are no reported axe violations or accepted exceptions. Baseline comparisons, Caliper-authored interactions, and physical-device checks were not run.

Archive Undo retains its five-second window. Errors, notes, and update offers stay until dismissed. These callers share the extracted presentation, but keep their original lifetime owners. The gate inventory drops seven entries; it gains none.

Evidence is under `/tmp/forgerie-existing-toasts/`: `acceptance.json`, posture captures, and the two `caliper-*/result.json` files. This fix remains on the session worktree until Land; the running app is unchanged.

## References

- [assistant-ui slash-command guide](https://www.assistant-ui.com/docs/guides/slash-commands) supplies the trigger architecture.
- [Dropbox Dash composer list](https://mobbin.com/screens/c57ed7c5-8cf3-4c29-a4c8-4ec09dfa2340) informed the anchored names/descriptions list. Existing assistant-ui homepage tokens remain unchanged.
