# Swipe to the session list

Swipe right anywhere on the session to pull the session list in from the left. Swipe left to push it back. The list follows your finger, so you can look and then let go:

| Gesture | Result |
| --- | --- |
| Swipe right, past 40% of the list's width | The list stays open. |
| Swipe right, short of 40% | The list slides back closed. |
| Swipe left on an open list, past 20% of its width | The list closes. |
| Swipe left, less than 20% | The list stays open. |

The thread dims as the list comes in. Lifting the finger hands the list to the usual slide, which carries on from where the finger left it. The Sessions button and a tap on the dimmed thread still work as before.

These numbers come from the Lit client (`appShell/panelPeek.ts` on main), which settled them on the Fold: 10 px of travel before the drag counts, at most 30 degrees from horizontal, 40% to open, and 20% to close.

## What a swipe leaves alone

- A vertical scroll, including one with a sideways wobble.
- A drag that starts in something that scrolls sideways, such as a wide code block or table. The drag scrolls it, and the list does not move.
- A drag while text is selected. It moves the selection handles.
- A finger that rests for half a second. A long press on a list row opens its row menu, as before.
- Mouse and pen. A mouse selects text, and a trackpad scrolls. Use the Sessions button.
- A docked list, where the window is at least 1000 px wide. It is already on screen.

The app claims a sideways drag only in the direction that can move the list. The rest of the page keeps its normal touch handling, so code and tables still scroll sideways under a finger.

## Limits

- There is no trackpad gesture. The Lit client opens its sheet from a two-finger trackpad swipe too.
- The right-hand panel of the Lit client has no counterpart here. A swipe left on a closed list does nothing.
- A click that follows a swipe is dropped, so the swipe cannot also press a row or the dimmed thread. The guard ends at the next press or after 400 ms, whichever comes first.
- If the system takes the touch, for example with the edge-back gesture, the list goes back to where it was. A second finger does not end or restart the first finger's swipe.

## Verification

```sh
nix shell nixpkgs#nodejs_24 -c npm run verify
SESSION_ID=<any session with messages> \
  nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node scripts/swipe-acceptance.mjs
```

`swipe-acceptance.mjs` sends real touch input through Chromium's touch emulation at all four Fold postures. It only reads; it sends nothing to the session.

| Check | Result (2026-10-05) |
| --- | --- |
| Unit and component tests | Build, lint, and all tests pass. New: the drag model (13) and pointer drags through the shell (7). |
| Independent review | Three bugs and two risks, all fixed and tested: a second finger left the list stuck half open, a 30–45 degree drag neither scrolled nor moved the list, the closing scrim caught taps for 200 ms, the click guard could eat a real tap, and a system cancel could open the list. |
| Touch, four postures | A short swipe falls back, a vertical scroll leaves the list closed, a swipe right opens it, and a swipe left closes it, at every posture. No browser error. |
| Sideways code | A rightward drag in a wide code block scrolled it from 300 px to 124 px. The list stayed closed. The check adds that code block to the page, because no session at hand held a line wide enough. |
| Physical Fold | Not tested. Chromium's touch emulation is not a finger on glass. |
