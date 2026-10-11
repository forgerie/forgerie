import { Excerpt } from "./Excerpt";
import { MarkdownFragment } from "./MarkdownFragment";

export const name = "Excerpt";
export const note = "Long content cut to a few lines with a toggle for the rest; short content shows whole, with no toggle";

const LONG = `The card folds the body after a few lines, so the choices under it stay close.

1. Open a session at the folded landscape posture.
2. Ask the agent for an issue with a long body.
3. Scroll the thread to the card.

The fade shows where the text is cut. **Show more** opens the rest inside a share of the pane, and the rest scrolls there.

- One more point that the cut hides.
- And another one, to make the body longer than the opened share on a short pane.
- And a third, with \`inline code\` in it.

A closing paragraph that only a reader who opened the body will see.`;

export default function Long() {
  return <Excerpt label="Body"><MarkdownFragment text={LONG} /></Excerpt>;
}
export function Short() {
  return <Excerpt label="Body"><MarkdownFragment text="One short paragraph needs no toggle." /></Excerpt>;
}
