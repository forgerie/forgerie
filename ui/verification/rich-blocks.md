# Rich blocks in replies

The agent writes plain Markdown. The browser app renders three structures from it while the reply streams. Other Markdown viewers, such as terminal Pi, show the same text as quotes and code blocks.

| Block | Agent writes | Renders as |
|---|---|---|
| Callout | A GitHub alert quote: `> [!WARNING]` and the quoted body. Kinds: NOTE, TIP, IMPORTANT, WARNING, CAUTION. | A hued rail and wash with an icon and a label. The body keeps full text colour. |
| Steps | A fenced block with the language `steps`. Each numbered line is a title; indented lines under it are detail. | A numbered sequence joined by a rail. |
| Compare | A fenced block with the language `compare`. `##` starts an option; `(recommended)` marks the pick; `+ ` and `- ` lines are strengths and costs. | One frame of options. They share a row while the column fits `--options × 13rem`, and stack below that. |
| Status | `status` fence: `[x]` done, `[~]` in progress, `[ ]` not started, `[!]` failed, `[-]` skipped; a first unmarked line is the title. | `Checklist`: a count, an in-order meter, and one labelled icon per item. "In progress" is a still mark, because a reply is a snapshot. |
| Files | `files` fence: paths marked `+`, `~` or `-`, with ` # note`; indentation under a `dir/` line nests. | `FileTree`: a marked tree with a count; single-child directories fold into one row. |
| Facts | `facts` fence: `Label: value` lines. | `FactList`: cells that share a row at 8.5rem minimum each and wrap by container width. |
| Diagram | `diagram` (or `mermaid`) fence with Mermaid source. | `Diagram`: the source until it has been still for 250 ms, then the drawing. A wide drawing keeps 0.62 scale or more and scrolls. Invalid source stays visible with a note. |

## How it works

- Callouts: `rehypeCallouts` runs after sanitizing and hardening, removes the marker, and sets `data-callout`. A reply cannot set the attribute itself, because raw HTML is skipped and sanitize runs first. Streaming repair shows an unfinished `[!WAR` as `!WAR` or drops it, so an empty or partial quote shows as a quiet callout without a label.
- Steps and compare: `componentsByLanguage` in `MarkdownText.tsx`. The fence is one block for Streamdown's splitter, so only the growing block parses again per token. Text inside the blocks renders through `Streamdown` fragments under the same link and image policy as the stream (`markdownPolicy.tsx`).
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

## Repeat

```sh
APP_URL=http://127.0.0.1:8510/ ./scripts/rich-blocks-acceptance.mjs
```
