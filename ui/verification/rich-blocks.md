# Rich blocks in replies

The agent writes plain Markdown. The browser app renders three structures from it while the reply streams. Other Markdown viewers, such as terminal Pi, show the same text as quotes and code blocks.

| Block | Agent writes | Renders as |
|---|---|---|
| Callout | A GitHub alert quote: `> [!WARNING]` and the quoted body. Kinds: NOTE, TIP, IMPORTANT, WARNING, CAUTION. | A hued rail and wash with an icon and a label. The body keeps full text colour. |
| Steps | A fenced block with the language `steps`. Each numbered line is a title; indented lines under it are detail. | A numbered sequence joined by a rail. |
| Compare | A fenced block with the language `compare`. `##` starts an option; `(recommended)` marks the pick; `+ ` and `- ` lines are strengths and costs. | One frame of options. They share a row while the column fits `--options × 13rem`, and stack below that. |
| Status | `status` fence: `[x]` done, `[~]` in progress, `[ ]` not started, `[!]` failed, `[-]` skipped; a first unmarked line is the title. | `Checklist`: a count, an in-order meter, and one labelled icon per item. "In progress" is a still mark, because a reply is a snapshot. |
| Files | `files` fence: paths marked `+`, `~` or `-`, with ` # note`; indentation under a `dir/` line nests. With no marks at all, the tree is a layout. | `FileTree`: a marked tree with a count; single-child directories fold into one row. A layout shows plain icons, "Layout, N entries" (the entries under the top folder, not the folder), and the notes in one aligned column, under each name below 30rem. |
| Facts | `facts` fence: `Label: value` lines. | `FactList`: cells that share a row at 8.5rem minimum each and wrap by container width. |
| Claims | `claims` fence: `verified:`, `inferred:`, `opinion:`, `unknown:` lines, and the research verdicts `supported:`, `partly:`, `unsupported:`, `contradicted:`; indented evidence; optional title. | `ClaimList`: a text label and icon per confidence, the claim, and its evidence in a quieter voice. A contradicted claim is struck through; the badge column widens when a long verdict label is present. |
| Commands | `commands` fence: one command per line, `# ` note above, `\` continues a line, `$ ` dropped. | `CommandList`: one row per command with its note and copy button, plus copy all. Long commands wrap under a hanging indent. |
| Details | `details` fence: first line is the plain-text summary, the rest is Markdown. | `Disclosure`: closed by default, uncontrolled so it stays open while the reply streams. |
| Bars | `bars` fence: a title, then `Label: value` lines with a number and optional unit. | `BarChart`: bars from zero on one scale, labels capped at 40% of the width, each value also as text. |
| Correction | `correction` fence: `was:`, `now:`, `cause:`. | `CorrectionPanel`: warm rail, the earlier claim struck through, the correct one strong, the cause muted. |
| Asides | `asides` fence: `high:`, `medium:`, `low:` items with indented detail. | `AsideList`: a tinted "Also noticed" panel; each item has a worded severity pill. |
| Timeline | `timeline` fence: `when - what` lines; indented detail. | `Timeline`: times right-aligned in one column on the event's baseline, events on a rail. |
| Sourced quote | A quote whose last line is `— source` (or `-- source`). | `QuoteFigure`: the quote in full text colour with the source as a code-face caption. Callouts are never treated as sourced quotes. |
| Checks | `checks` fence: optional title, then `pass:`, `fail:`, `skip:`, `unchecked:` lines, each `name — result`. | `CheckResults`: the checklist's frame, a count, an in-order meter of what ran, the result at the trailing edge, and a tinted "Not checked" group outside the meter. |
| Findings | `findings` fence: `verdict: approve` / `changes needed` / `blocked`, then `P0`/`P1`/`P2`/`nit`/`blocker`/`should-fix` `path:line — problem`, with an indented `fix:`. | `FindingList`: the verdict in words with its icon on a toned top rule, defects worst first (equal ranks in written order), a worded severity pill, the location in the code face (it opens the file when it exists, like `files`), the problem and the fix. |
| Recap | `recap` fence: `goal:`, `done:` and `left:` (each repeatable), `needs you:` (`nothing` for none), `next:`. | `RecapPanel`: "Needs you" first on the live wash and rail, whatever line it was on; with nothing waiting the header says so. |
| Verdict | `verdict` fence: `yes:`, `no:` or `partly:` and one reason. | `VerdictLine`: a callout's rail and wash with the answer as a large word and its own icon shape (check, cross, half circle), so it reads without colour. Nothing shows until the word and its colon arrive. |
| Commits | `commits` fence: optional title, then `hash state subject`, the state `local`, `pushed`, `landed` or `deployed`. | `RevisionList`: a code sheet with a copy button per hash (Forgerie does not know a repository's web address), the subject, and a word plus four-step meter; below 27rem the state moves under the subject. |
| Delta | `delta` fence: optional title, then `lower:` or `higher:` (optional) `label: before -> after`. | `DeltaTable`: before, after, the change over its percentage, and Better, Worse, Same or Changed with a trend arrow. A change from 0 says "from 0"; one across 0 says "crosses 0". Below 32rem the label takes its own line. |
| Ledger | `ledger` fence: optional title, then `label: amount`, `= label: amount` for a total, `a to b` for a range, `?` for no amount. | `Ledger`: one right-aligned column of tabular figures, a rule above each total, a double rule under the last, negatives with a minus sign and the failure ink. A row whose amount has not arrived stays empty. |
| Diagram | `diagram` (or `mermaid`) fence with Mermaid source. | `Diagram`: the source until it has been still for 250 ms, then the drawing. A wide drawing keeps 0.62 scale or more and scrolls. Invalid source stays visible with a note. |

## How it works

- Callouts: `rehypeCallouts` runs after sanitizing and hardening, removes the marker, and sets `data-callout`. A reply cannot set the attribute itself, because raw HTML is skipped and sanitize runs first. Streaming repair shows an unfinished `[!WAR` as `!WAR` or drops it, so an empty or partial quote shows as a quiet callout without a label.
- Steps and compare: `componentsByLanguage` in `MarkdownText.tsx`. The fence is one block for Streamdown's splitter, so only the growing block parses again per token. Text inside the blocks renders through `Streamdown` fragments under the same link and image policy as the stream (`markdownPolicy.tsx`).
- Round-five blocks parse in `richBlockSyntax.ts`. A line before the first row becomes a title only once another line follows it, so a first row that is still arriving never shows as a title. `findings` gets the same file links as `files` through `MarkdownText`; the existence check is `useExistingPaths`, shared by both.
- Round-two blocks are system components in `src/ui/` (`Checklist`, `FileTree`, `FactList`, `Diagram`, `MarkdownFragment`), each with a part and a catalogue line. They take the fence source as `code` and read no state, so they pass the decomposition gates. `markdown/blockFences.ts` maps the languages to them.
- Diagrams: `drawDiagram.ts` loads Mermaid on the first diagram (a separate 168 kB gzip chunk plus its own lazy chunks; the main entry grew 3.1 kB gzip). Mermaid runs at `securityLevel: "strict"`. Colours come from the `--diagram-*` custom properties, converted to sRGB through a one-pixel canvas, so diagrams follow the light and dark themes.
- Agent guidance: `src/shared/replyFormatGuide.ts` is the single source. Sessiond appends it to every hosted session's system prompt through `appendSystemPromptOverride`. `src/server/sessions/replyFormatGuide.acceptance.test.ts` proves it reaches the model's system message, including with a profile `SYSTEM.md`, and fails when the hook is removed. `ui/src/ui/markdown/replyFormatGuide.test.ts` parses every example with the renderer's parsers and checks that the guide names exactly the rendered languages.
- Delegated agents do not receive the guide. `pi-subagents` builds each child's resource loader itself and loads no host extensions for foreground children, so there is no deterministic hook without patching it.

## Checks

Checked on 2026-10-08 against the preview fixture (`rich-blocks`, `rich-blocks-running`, `rich-blocks-live`).

| Check | Result |
|---|---|
| `npm run verify` | Static checks pass. Root tests: 2193 pass; one provider-policy acceptance test timed out under full-suite load and passes alone and on `main`. UI: build, lint, and 1017 tests pass. |
| `scripts/rich-blocks-acceptance.mjs` | All four Fold postures in both schemes: no page overflow, options never split across rows, both callouts labelled, four steps. The live scenario streams the reply in 6-character chunks to completion with no exceptions. |
| `scripts/streamdown-acceptance.mjs` | Still passes. |
| Visual review | Read the callout, steps, compare, and mid-stream PNGs. At folded portrait the column is 443 px, so two options share a row at about 221 px each. |

Physical Fold touch behaviour and real model output are not verified. A real model may not follow the guide.

Round two, checked on 2026-10-08:

| Check | Result |
|---|---|
| `npm run verify` | Root: 228 files pass. UI: 111 files pass on rerun; `sessionStore.dialog.test.ts` failed once under full-suite load and passes alone 3 of 3 times. |
| Gates | 36 pass. `check-pending.mjs main`: 667 to 665, nothing grew. `prove-bite.mjs`: 36 of 36 bite (the "layer without parts" plant now uses the organism layer, since an atom part exists). |
| `scripts/rich-blocks-acceptance.mjs` | All four postures, both schemes: no overflow, fact cells at least 146 px, checklist states and count exact, real Mermaid draws, diagram scale at least 0.62 (scrolls at folded portrait). The report streams live to completion with one diagram. |
| Visual review | Read the facts, status, files and diagram PNGs. |

Round three, checked on 2026-10-09:

| Check | Result |
|---|---|
| `npm run verify` | Static checks pass. Root: 226 of 228 files; `globalProviderPolicy.acceptance` and `smartTurnProcess` failed on timing under load and pass alone. UI passes. |
| Gates | 36 pass with no new exceptions; `prove-bite.mjs` 36 of 36. |
| `scripts/rich-blocks-acceptance.mjs` | All four postures, both schemes: no overflow, bars at 0.43 and 0.65 of the largest (exact ratios), bar tracks aligned, details summary 44 px tall, three copy buttons. The answer streams live to completion. |
| Visual review | Read the claims, commands, bars and open-details PNGs. Long commands first scrolled out of view at folded portrait; they now wrap. |

Round four, checked on 2026-10-09:

| Check | Result |
|---|---|
| Guide | Rewritten as a compact reference: 17 blocks in 2,600 characters (round three: 13 blocks in 4,366). `replyFormatGuide.test.ts` caps it at 3,000 characters. |
| `npm run verify` | Root 229 of 229 files, UI 116 files pass. |
| Gates | 36 pass; ratchet 660 to 660; `prove-bite.mjs` 36 of 36. The domain-noun gate rejected the first name, `CorrectionNote` ("Note" is a Forgerie feature), so it is `CorrectionPanel`. |
| `scripts/rich-blocks-acceptance.mjs` | All postures and schemes: no overflow, correction first, timeline events and times aligned, aside text aligned, long quote source wraps without overflow; the follow-up streams live to completion. |
| Visual review | Timeline times first sat above their events' baseline; they now share it. |

## Repeat

```sh
APP_URL=http://127.0.0.1:8510/ ./scripts/rich-blocks-acceptance.mjs
```
