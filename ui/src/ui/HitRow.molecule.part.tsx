import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { HitRow } from "./HitRow";

export const name = "Hit row";
export const note = "One item a search found: name, age, where, labels, the passage with its matched words, and what else matched";
export const checks = {
  default: {
    "pressing the row opens it": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: /Plant the tomatoes/ }));
      expect(canvas.getByText("Opened Plant the tomatoes")).toBeVisible();
    },
  },
} satisfies StateChecks;

const PASSAGE = "Move the tomato seedlings out once the nights stay above ten degrees, and water them in the morning, not at night.";
const marks = (text: string, word: string): [number, number][] => {
  const found: [number, number][] = [];
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) found.push([at, at + word.length]);
  return found;
};
export default function Plain() {
  const [opened, setOpened] = useState("Nothing opened");
  return <div>
    <HitRow title="Plant the tomatoes" where="garden" time="2d" timeTitle="9 October 2026" speaker="You"
      passage={PASSAGE} marks={marks(PASSAGE, "tomato")} footnote="+3 more matches" onPress={() => setOpened("Opened Plant the tomatoes")} />
    <p aria-live="polite">{opened}</p>
  </div>;
}
/** Labels say that the item is put away, and that the passage is off its main line. */
export function Tagged() {
  return <HitRow title="Seed order for next spring" where="garden · beds" time="5w" tags={["Archived", "Other branch"]}
    passage="The heirloom tomato seeds sold out, so the order takes the cherry tomato mix instead." marks={[[13, 19], [69, 75]]} onPress={() => undefined} />;
}
/** A long name is cut; a long passage keeps its lines and then stops. */
export function LongText() {
  const text = `${PASSAGE} ${PASSAGE}`;
  return <HitRow title="A plan for the whole garden that has a name long enough to be cut at the end of its line" untitled={false}
    where="a-folder-with-a-long-name/and-a-branch-with-a-longer-one" time="41m" speaker="You" passage={text} marks={marks(text, "water")}
    footnote="+128 more matches" onPress={() => undefined} />;
}
/** The item has no name of its own. */
export function Untitled() {
  return <HitRow title="Untitled" untitled where="garden" time="<1m" passage="Water the tomatoes." marks={[[10, 18]]} onPress={() => undefined} />;
}
