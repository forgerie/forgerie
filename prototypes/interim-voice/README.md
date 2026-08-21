# Interim voice

**Verdict (2026-08-20): B, the process rail, is adopted and implemented.**
The transcript now groups steps chronologically (`groupChatMessages` flushes
on readable content, part-order aware) and `chatTurnFlow` splits each turn
into opener, railed work, promoted answer, and any continuation below it. The
fold-summary meta moved to a rail-closing line. The other treatments stay here
as the record of the study. Open follow-ups moved to the backlog: the running-turn tail (liveness,
queued prompts, asks) still renders below the rail rather than inside it, and
the promotion moment has no designed transition.

The question: a turn usually carries several assistant text blocks. The early
ones narrate progress. The last one is the real reply. Today all of them
render in the same prose voice, so the transcript reads as one undifferentiated
essay. What should the three voices look like: what the user said, what the
agent finally answered, and the narration in between? The interim blocks must
stay visible. Hiding them is out of scope.

One conversation, four treatments, switchable in place. Open
`index.html` and flip with the floating bar, the arrow keys, or a
`#variant` fragment (`?variant=` also works on load).

| Key | Name | What changes |
|---|---|---|
| `today` | One voice | Baseline. Interim and answer share the full prose voice. Steps pool in the foot fold. |
| `registers` | Two registers | Interim drops to the small muted voice, in place. The answer keeps the reading voice. Structure untouched. |
| `rail` | Process rail | Interim narration and per-cluster step folds share one hairline rail, in the order they happened. The answer stands outside the rail. The foot fold dissolves into the rail. |
| `promote` | Promoted answer | The work log stays quiet: narration and the steps line share a register, and the fold moves above the answer. Only the answer is marked, with an accent hairline, and it carries the turn meta. |

## The promotion rule

All three treatments rest on the same rule, and it needs no new data from the
server. The trailing assistant text stays interim only while message content
is actively arriving. When message delivery finishes, or later tool, question,
or compaction work begins, the latest assistant text becomes the answer and
stays promoted. If newer prose starts streaming, the previous answer remains
promoted until the newer message settles. `chatTurns` in
`src/client/src/chatGroups.ts` owns this split.

The cost is the promotion moment. The last interim block restyles when message
delivery finishes. On `rail` it also moves outside the rail. Later work does
not move it back. The third turn in the mock is live, so every variant shows
the pre-promotion state: nothing is bright yet, and that is the point.

## Run and capture

```bash
# view (also works over file://)
cd prototypes && python3 -m http.server 8600
# open http://127.0.0.1:8600/interim-voice/#registers

# re-render the PNGs (needs Nix)
./render.sh
```

`render.sh` drives `capture.mjs`, which emulates viewports over CDP the way
`scripts/capture-postures.mjs` does. It does not use `--window-size`: headless
chromium clamps window widths below about 500px, so a 475px request lays out
at 500px and the shot crops the right edge. The first capture round here hit
exactly that.

Per variant it writes three shots: `*-overview.png` (932x553, top of the
transcript), `*-answer.png` (475x638, the showcase answer with interim blocks
above it), `*-tail.png` (475x638, the live turn). Fragment flags drive the
scroll position (`.answer`, `.tail`) and hide the switcher (`.bare`). A
`.probe` flag prints layout widths into the page for debugging.

## Open questions

- Promotion motion. Does the restyle read as a jump on the real fold? The
  `promote` treatment brightens in place and hides it best. The `rail`
  treatment moves the block and hides it worst.
- Short answers. A turn that ends with one word ("Done.") still gets promoted.
  On `promote` that word carries the accent hairline and the meta. Odd or fine?
- Turns that end without text, for example in an `ask_user` question. The rule
  needs a fallback for what closes the turn visually.
- Legibility of the muted small voice for narration that carries real content.
  The mock's second interim block in turn 2 is a stress case.
- On `rail`, an open step fold nests its own hairline inside the rail. The
  mock removes the inner rule. Check texture with several folds open.
