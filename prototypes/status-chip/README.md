# Status chip as the first indicator

A mockup that removes the red notice bar above the chat. The header status chip
says what is wrong in one or two words. When there is more to say, the chip is
a button and opens a panel from the same corner.

Open `board.html` to see every scene at the Fold 8 folded portrait and unfolded
landscape viewports. Open `index.html?scene=<name>` for one scene at the window
size. Run `./render.sh dark` or `./render.sh light` to capture all four
postures into `shots/` (ignored by git).

| Scene | What it shows |
|---|---|
| `before` | Today: the chip and a red bar say the same thing. |
| `reconnecting` | Only the chip, amber, with a chevron. |
| `reconnecting-open` | The reason, the next try, Try now, and the draft promise. |
| `error` | An idle session with one problem: the problem names the chip. |
| `error-open` | Plain words, then Pi's own text in a capped block with Copy. |
| `running-problems` | The run keeps its word; a count rides along. |
| `running-problems-open` | The state on top, the problems below, each dismissed on its own. |
| `disconnected-open` | The reason and Reload, in the panel instead of the chat. |

## Rules the mockup follows

- The chip shows one word. Connection trouble outranks problems, and problems
  outrank activity. When a problem rides along with another state, it shows
  as a count.
- A chip with detail is a button with a chevron. A chip without detail stays a
  plain status word.
- A new problem rings the chip twice. That is the only motion that asks for a
  look, because the bar no longer does.
- The panel opens in the toast corner. Its width is `min(25rem, 100cqi - 1rem)`
  and its height stops above the window edge; the body scrolls. The chat dims
  under it and the header does not, so the chip stays lit.
- The state section uses the AlertCard grammar: a rail and a wash in the chip's
  tone, never a red box.
