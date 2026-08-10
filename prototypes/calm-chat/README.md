# Calm chat — mockup

Static sketches for adopting the **Calm Conversation** transcript design in the
chat surface. Open the HTML files directly; they have no dependencies.
Re-render the PNGs with `./render.sh` (needs Nix; uses chromium).

Origin: the design was selected at a human gate in the earlier Forgerie rebuild,
recorded in `~/code/github/simonwjackson/forgerie/docs/rebuild/pi-chat-concept-review.md`.
The concept file is `0d6df9f:src/lattice/client/features/pi-chat/concepts/CalmConversation.tsx`
in that repo. It was React + Tailwind; this fork is Lit, so adoption is a
re-implementation of the design language, not a port.

| File | What it shows |
|---|---|
| `01-today.html` | The current transcript: card per message, per-role border and fill, sticky uppercase role labels, event-group disclosure, warning-coloured queue panel. |
| `02-calm.html` | The proposal: reading column, no cards, no role labels, tool calls as footnote citations, quiet error voice, quiet composer. |

Both files carry the same conversation so the comparison is honest. Both use the
real Forgerie Dark token values from `src/client/src/plugins/themes/index.ts`.

`render.sh` also captures `02-calm.html#activity`, which scrolls the transcript
to the unfolded activity fold.

## No citations

An earlier draft borrowed forgerie-next's footnote citations — superscript
references tying a tool call to a paragraph. They are **dropped**.

Pi never emits that relationship. It could only be inferred from block
adjacency: every tool or thinking block between one text block and the next
belongs to the first. That means `¹` could honestly say no more than *"the agent
ran this right after writing this paragraph"* — chronology dressed as
attribution. Common turn shapes (all activity, then one summary paragraph) cite
nothing at all, so the fold was carrying the weight regardless.

What remains is one activity fold per turn, holding every step in order.

## Where the fold sits

Above the reply, not below it. That is the order `groupChatMessages` already
emits: it accumulates technical parts and flushes them the moment readable
content appears (`src/client/src/chatGroups.ts:22–31`). It also reads
chronologically — the agent worked, then it spoke.

## What the sketch commits to

| Question | Today | Calm |
|---|---|---|
| Who said this? | Uppercase label in a sticky header | Weight and colour — user is bright and semibold, assistant is muted prose |
| What kind of message is this? | Border and fill colour per role | Nothing. Roles stop being colour-coded |
| What did the agent run? | Warning-coloured tool cards in a disclosure | Superscript citations in the prose, plus `Show all activity` |
| Where does shell output go? | Success-coloured card | Monospace block behind a grey hairline |
| How wide is the text? | Full pane | `clamp(34ch, 92cqi, 66ch)`, centred, container-relative |
| How does an error read? | Red text in a bordered card | Danger-coloured lead phrase, then plain detail, no box |

Cited tool calls use an accent hairline and a numbered label; user-requested
shell output uses a grey hairline. Without that split the two blocks were
indistinguishable — the first render proved it.

## Open problems the sketch does not solve

- **No send button.** Calm sends on Enter. The acceptance device is a phone
  where Enter usually inserts a newline. Today's composer has an explicit send
  control; Phase 6 has to answer this before it can ship.
- **Per-message copy and the message id have no home.** They live in the sticky
  header Calm deletes. Phase 4 has to design a replacement, not adopt one.
- **Six content types were never tested against Calm.** Images, attachments,
  bash output, skill reads, compaction notices, and extension dialogs did not
  exist when the gate ran — that milestone had tools off.
- **The measure depends on the font.** `ch` resolved to ~10px under the headless
  fallback font. Confirm the column width on the real device before fixing the
  cap.
- **The measure again:** confirm on-device before fixing the cap.

## Decided while sketching

- **Unfolded activity is hairline-only.** An earlier draft gave each tool call a
  filled, rounded block for its arguments and another for its result — four
  uncited calls stacked eight rectangles, re-introducing the card texture the
  transcript deletes. Argument and result now separate by tone (`ink-muted` vs
  `ink-dim`) inside one hairline block.
- **Arguments render as summaries, not raw JSON.** forgerie-next prints
  `argsJson` verbatim. This fork already has `summarizeArgs()` and
  `previewFromDetails()` in `src/client/src/chatMessages.ts`. Keep ours.
