import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { ValueList } from "./ValueList";

export const name = "Value list";
export const note = "A short list of typed values: a box and a named Remove for each, a problem under a box, an empty text, and Add under the list";
export const checks = {
  default: {
    "Add puts a blank box at the end with focus in it": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "Add a name" }));
      expect(canvas.getByRole("textbox", { name: "Name 1" })).toHaveFocus();
    },
  },
  Several: {
    "each Remove names its value, and removes only that one": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "Remove grace" }));
      expect(canvas.queryByDisplayValue("grace")).toBeNull();
      expect(canvas.getAllByRole("textbox")).toHaveLength(2);
      expect(canvas.getByRole("textbox", { name: "Name 2" })).toHaveFocus();
    },
  },
  Problem: {
    "a box with a problem reads as invalid and is described by it": async ({ canvas, expect }) => {
      expect(canvas.getByRole("textbox", { name: "Name 2" })).toHaveAccessibleDescription("Use lower-case letters only.");
      expect(canvas.getByRole("textbox", { name: "Name 2" })).toBeInvalid();
      expect(canvas.getByRole("textbox", { name: "Name 1" })).toBeValid();
    },
  },
} satisfies StateChecks;

/** A name is lower-case letters, and a name is listed once. */
const problemsOf = (values: readonly string[]) => values.map((value, index) => {
  const name = value.trim();
  if (!name) return undefined;
  if (!/^[a-z]+$/.test(name)) return "Use lower-case letters only.";
  return values.slice(0, index).some((other) => other.trim() === name) ? `${name} is already listed.` : undefined;
});
function Stateful({ start, disabled, limit }: { start: string[]; disabled?: boolean; limit?: number }) {
  const [values, setValues] = useState(start);
  return <ValueList values={values} problems={problemsOf(values)} disabled={disabled} limit={limit} onChange={setValues} placeholder="name"
    itemLabel={(index) => `Name ${String(index + 1)}`} removeLabel={(value) => `Remove ${value || "blank name"}`} addLabel="Add a name"
    empty="No names yet. Add one to let it in." />;
}
export default function Empty() { return <Stateful start={[]} />; }
export function Several() { return <Stateful start={["ada", "grace", "wolfeschlegelsteinhausenbergerdorffwelchevoralternwarengewissenhaft"]} />; }
export function Problem() { return <Stateful start={["ada", "Grace Hopper", "ada"]} />; }
/** At its limit of three, Add is off. */
export function Full() { return <Stateful start={["ada", "grace", "edsger"]} limit={3} />; }
/** While a save is in flight, every box, Remove, and Add is locked. */
export function Disabled() { return <Stateful start={["ada", "grace"]} disabled />; }
