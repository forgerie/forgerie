# Rich blocks in replies

The agent writes plain Markdown. The browser app renders three structures from it while the reply streams. Other Markdown viewers, such as terminal Pi, show the same text as quotes and code blocks.

| Block | Agent writes | Renders as |
|---|---|---|
| Callout | A GitHub alert quote: `> [!WARNING]` and the quoted body. Kinds: NOTE, TIP, IMPORTANT, WARNING, CAUTION. | A hued rail and wash with an icon and a label. The body keeps full text colour. |
| Steps | A fenced block with the language `steps`. Each numbered line is a title; indented lines under it are detail. | A numbered sequence joined by a rail. |
| Compare | A fenced block with the language `compare`. `##` starts an option; `(recommended)` marks the pick; `+ ` and `- ` lines are strengths and costs. | One frame of options. They share a row while the column fits `--options × 13rem`, and stack below that. |

## How it works

- Callouts: `rehypeCallouts` runs after sanitizing and hardening, removes the marker, and sets `data-callout`. A reply cannot set the attribute itself, because raw HTML is skipped and sanitize runs first. Streaming repair shows an unfinished `[!WAR` as `!WAR` or drops it, so an empty or partial quote shows as a quiet callout without a label.
- Steps and compare: `componentsByLanguage` in `MarkdownText.tsx`. The fence is one block for Streamdown's splitter, so only the growing block parses again per token. Text inside the blocks renders through `Streamdown` fragments under the same link and image policy as the stream (`markdownPolicy.tsx`).
- Agent guidance: `src/server/sessions/replyFormatGuide.ts` adds a section to every hosted session's system prompt through `appendSystemPromptOverride`. Keep its examples in step with `richBlockSyntax.ts`.

## Checks

Checked on 2026-10-08 against the preview fixture (`rich-blocks`, `rich-blocks-running`, `rich-blocks-live`).

| Check | Result |
|---|---|
| `npm run verify` | Static checks pass. Root tests: 2193 pass; one provider-policy acceptance test timed out under full-suite load and passes alone and on `main`. UI: build, lint, and 1017 tests pass. |
| `scripts/rich-blocks-acceptance.mjs` | All four Fold postures in both schemes: no page overflow, options never split across rows, both callouts labelled, four steps. The live scenario streams the reply in 6-character chunks to completion with no exceptions. |
| `scripts/streamdown-acceptance.mjs` | Still passes. |
| Visual review | Read the callout, steps, compare, and mid-stream PNGs. At folded portrait the column is 443 px, so two options share a row at about 221 px each. |

Physical Fold touch behaviour and real model output are not verified. A real model may not follow the guide.

## Repeat

```sh
APP_URL=http://127.0.0.1:8510/ ./scripts/rich-blocks-acceptance.mjs
```
