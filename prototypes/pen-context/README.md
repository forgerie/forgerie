# Pen prototype — throwaway

**Question it answers:** on a pen tablet (Galaxy Tab Ultra 11 with an S Pen),
what can Forgerie do with a pen that it cannot do as well without one?

**Bet under test:** the pen creates *context*; the keyboard gives *instructions*.
Marking what you mean is faster with a pen than selecting it with a finger.

Nothing here ships. No build step, no dependencies, no persistence, outside
`tsc` / `eslint` / `knip` / `vite` scope like the rest of `prototypes/`.

## Run it

```bash
cd prototypes
nix shell nixpkgs#nodejs_22 -c node serve.mjs . 8600 0.0.0.0
```

On the tablet, use the **https** address — the microphone needs a secure
context: <https://zao.hummingbird-lake.ts.net:8444/pen-context/>

That address is a `tailscale serve` proxy onto port 8600:

```bash
tailscale serve --bg --https=8444 http://127.0.0.1:8600   # start
tailscale serve --https=8444 off                          # stop
```

Plain <http://zao:8600/pen-context/> still works for everything except voice.

Variants switch from the bottom bar or `?v=`:

| Variant | URL | What it tests |
|---|---|---|
| Circle to context | `?v=context` | Mark the transcript, talk while marking |
| Margin review | `?v=margin` | Paper-style review notes next to diff lines |
| Send a drawing | `?v=sketch` | Load a screenshot, mark it, send the picture |
| Pen probe | `?v=probe` | What this browser reports about the pen |

`finger draws: off` turns on touch drawing, so the prototype is usable with no
pen. `scroll: manual / native` switches the two scroll models described below.

## Gesture vocabulary under test (variant A)

| Mark | Meaning | Prompt line |
|---|---|---|
| circle / lasso | include the enclosed lines | `include: file:108-110` |
| underline | look at this | `look at: …` |
| strike through the middle | ignore this | `ignore: …` |
| arrow | relate the last two marks | `relate: a → b` |
| scribble | focus the note field for handwriting | free text |
| side button held | force "ignore" for that stroke | red ink |
| eraser tip | remove ink, which removes the item | — |

## Fixed: strokes lost until the first release

**Symptom reported on the tablet:** the pen only drew after the first press and
release in an area.

**Cause (inferred, not reproduced on this machine):** the ink canvas was inert
until a pen *hover* armed it. When the pen touched down with no hover event
first, the browser had already decided that gesture was a scroll, so the stroke
went to the scroller and was lost. After the release, the layer was armed, so
the next stroke drew. Headless Chromium now covers this case: `check-pen.mjs`
draws one stroke with no hover beforehand and fails if no mark lands.

**Fix — `scroll: manual` (new default):** the ink layer listens at all times and
the content never pans by itself (`touch-action: none`). A finger scroll is
hand-rolled in `ink.js`, so a pen stroke can never be swallowed by a scroll
gesture, hover or no hover.

**Cost, stated plainly:** the finger scroll is no longer the platform's. Flick
momentum is a simple friction decay and pinch-zoom is off inside the marked
area. Press `scroll: native (hover arming)` in the bottom bar to feel the old
model again and judge which trade you prefer.

## Pen plus voice

Handwriting into a text field is a platform feature and not very interesting.
The pairing under test is **mark with the hand, explain with the mouth**: turn
on `voice while marking`, and dictation starts the moment the pen touches down
and stops about 2.5 s after it lifts. The words land in the prompt draft beside
the marks. The header lamp turns red while listening.

Web Speech needs https, so use the tailnet https address. On plain http the
prototype says so instead of failing quietly.

## Send a drawing

`?v=sketch` is now the full loop: load a screenshot from the tablet (or paste
one), draw on it, speak the instruction, and send. The ink and the backdrop are
flattened into one PNG, and the toast reports the exact payload size that would
go to the agent.

## Check it headlessly

```bash
./check-pen.mjs      # drives a synthetic pen over CDP, screenshots, asserts marks land
./debug-lasso.mjs    # dumps stroke classification and hit rects for one lasso
```

`check-pen.mjs` writes screenshots to `/tmp/pen-proto` and exits non-zero on
console errors. Chromium reports `pointerType: "pen"`, so the same code path
runs, but it cannot reproduce real pressure, tilt, palm rejection, or hover
latency. Only the tablet answers those.

## Known prototype limitations

- Ink over a horizontally scrollable `<pre>` does not follow that inner scroll.
- Hand-rolled scrolling has no rubber-band, no pinch-zoom, and simpler momentum.
- Nothing is actually sent; "Send" reports the payload it would send.
- Stroke classification is heuristic and tuned by eye (`geometry.js`).
- No handwriting recognition. The note field relies on Samsung's own
  ink-to-text, which is exactly what variant A's scribble gesture tests.
- Ink is not persisted, and nothing is sent anywhere.

## Verdict

<!-- Fill this in after using it on the tablet, then delete the prototype. -->

- Is the lost-stroke bug gone in `scroll: manual`? …
- Is hand-rolled scrolling an acceptable price for it? …
- Does pen plus voice beat pen plus handwriting? …
- Which gesture earned its place, and which felt like a party trick? …
- What did the probe say the S Pen actually reports? …
