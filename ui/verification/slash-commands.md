# Pi slash commands

The standalone MVP uses assistant-ui 0.15.22's trigger popover and slash-command adapter. No dependency change is required.

## Behavior

Type `/` at the start of the composer. Search matches a command's name and its description; a skill is matched by its name alone, because its description is written for the model and never appears in the palette (`paletteDescription` in `src/commands.ts`). Arrow keys, Enter, Tab, or a pointer select a command. Selection inserts plain `/command ` text. It does not execute the command. Add arguments and use Send to execute it. Escape closes the picker without deleting text.

One row is one height. A command's description rides its name's line and gives way at the row's end, so no row can grow into a paragraph; a skill shows its name alone. The palette is a `FloatingPanel` holding an `OptionList` in highlight mode, the same parts the `@` mention popover uses, and its rows are `OptionRow`s with `detailsPlacement: "trailing"`.

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

Omit `LIVE_SESSION` for fixture-only acceptance. The live check executes only `/session`, not a model prompt. Fixture rendering uses injected command data, not network interception. One fixture command is a skill with a real paragraph-length description, so the acceptance check can see a row that would grow.

Use the parent repository's `scripts/capture-postures.mjs` for captures. The fixture URL is `/verification/preview.html?scenario=slash-capture`, opened with `--type /`: the harness types into the composer through CDP, because a value written straight into the editor's state leaves the palette closed. Set `CHROME_BIN` to the Chromium executable if the script's login-shell lookup cannot see the Nix shell path.

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

Confirmations use the existing `Toast` component in the page's top-end `ToastRegion`, with the same styling and placement as other notices. They dismiss after the existing 2.5-second information interval. Hover or keyboard focus pauses the timer. A new confirmation starts a fresh timer, including repeated text. The toast does not move the composer or take focus. Long names scroll within a height budget, with the close action outside the scroll region. Detailed output is keyboard-scrollable.

From the repository root, run `APP_URL=http://127.0.0.1:5173 nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node ui/scripts/command-feedback-acceptance.mjs`.

Verified with 48 browser layout cases: four Fold postures plus two constrained sizes, both themes, and four feedback states. Drafts survive four posture transitions. Manual dismissal, hover pause, expiry, choice confirmation, and an extreme name also pass. Fourteen Caliper states across four postures render without errors or spill; both image samples were reviewed. Four `ToastRegion` OverThread cases have incomplete contrast audits because text overlaps the page behind the toast. Two folded-landscape panel states have incomplete contrast audits for scroll-clipped text. There are no reported axe violations or accepted exceptions. Baseline comparisons, Caliper-authored interactions, and physical-device checks were not run.

Archive Undo retains its five-second window. Errors, notes, and update offers stay until dismissed. These callers keep their original lifetime owners. The shared `Toast` timer is optional. The gate inventory drops one entry; it gains none.

Full repository verification passed after rebasing onto `886b49b6`: typecheck, lint, knip, UI gates, build, 1,803 server tests, and 1,325 UI tests. Three server tests and one UI test were skipped. One UI test file was also skipped.

Evidence is under `/tmp/forgerie-land-toasts/`: `acceptance.json`, posture captures, and three `caliper-*/result.json` files for `Toast`, `ToastRegion`, and `CommandResultPanel`. Landing uses a rebase and fast-forward onto `main`. Service restarts are excluded by the user's instruction; runtime deployment remains unverified.

## Palette row treatment, 2026-10-09

A skill's description is written for the model: Pi hands the agent that paragraph to decide when to load the skill. Measured on this host, 47 installed skills carry descriptions of 50 to 953 characters, median 205, and 36 of the 47 are over 120. Cutting at the first sentence still spans 5 to 189 characters, so no rule shortens that text honestly. The palette now shows a skill's name alone, and a skill no longer matches a search by its description, so a row never appears for a reason the reader cannot see. A command's description, written for a person, rides its name's line and gives way at the row's end.

Every row is one height. The palette is a `FloatingPanel` holding an `OptionList` in highlight mode, the same parts the `@` mention popover uses, and its rows are `OptionRow`s with `detailsPlacement: "trailing"`. `.command-popover` and `--command-room` are gone; `.command-option` stays for the command result panel.

| Check | Result |
|---|---|
| Build, lint, unit tests | Root `npm run verify` passed: typecheck, lint, knip for both trees, 1,824 root tests, then the `ui/` suite — build, ESLint, gates and 1,350 tests. |
| Row treatment | `scripts/slash-acceptance.mjs`: 26 rows, every row 44 px, every row carrying `data-details="trailing"`, `/skill:testing` showing its name alone and `/compact` its line. |
| Browser interaction | The same script passed keyboard completion, highlighted-row scrolling, and ask-mode precedence across 12 posture and theme combinations with no page exception. `/re` returns two rows, not three: the skill no longer answers to "regression tests" in its description. |
| Fold matrix | Eight captures in `/tmp/slash-rows-shots/` (four postures, both schemes) were read and reviewed: one row height everywhere, no clipped control, no posture changes the row structure. |
| Additional container sizes | 280×500 and a 475×280 keyboard-height budget passed in both schemes. |
| Part render | `caliper-render` on `OptionRow.atom.part.tsx`, state `TrailingDetails`: `Rendered` on all four devices, `spill` null, `console` empty; the folded-portrait PNG was read. |
| Mention palette | `scripts/mentions-acceptance.mjs` passed all 32 cases, so the shared parts did not move under it. |
| Live Pi endpoint | Not re-run: it needs an idle session (`LIVE_SESSION=<id>`). The palette rows changed; the run path did not. |

Limits: a skill can no longer be found in the palette by a word from its description; the Skills library in Settings shows each description in full. An extension command with a long description is cut at the row's end. At the 22rem cap the panel can end on a row boundary, so the cut row that hints "more below" may not show at the widest postures; the scrollbar is the remaining hint. Physical Fold keyboard and touch validation remains unverified.

The capture harness gained `--type <text>`, which types into the composer through CDP: a value written straight into the editor's state leaves a completion popover closed. The three row treatments compared for this change are in `verification/slash-palette-mockup.html`.

## References

- [assistant-ui slash-command guide](https://www.assistant-ui.com/docs/guides/slash-commands) supplies the trigger architecture.
- [Dropbox Dash composer list](https://mobbin.com/screens/c57ed7c5-8cf3-4c29-a4c8-4ec09dfa2340) informed the anchored names/descriptions list. Existing assistant-ui homepage tokens remain unchanged.
