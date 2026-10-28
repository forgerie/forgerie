import { FoldHandle } from "./FoldHandle";

export const name = "Fold handle";
export const note = "The input row's one press that folds the ledge away and back: counts in words or as a total, and a live dot for what arrived while folded";

const counts = [{ count: 3, noun: "proposals" }, { count: 2, noun: "queued" }];
const toggle = () => undefined;
export default function Words() {
  return <FoldHandle counts={counts} form="words" folded={false} label="Fold 3 proposals, 2 queued away" onToggle={toggle} />;
}
/** A row with no room for the words: one total. The words stay in the label. */
export function Total() {
  return <FoldHandle counts={counts} form="total" folded={false} label="Fold 3 proposals, 2 queued away" onToggle={toggle} />;
}
export function Folded() {
  return <FoldHandle counts={counts} form="words" folded label="Show 3 proposals, 2 queued" onToggle={toggle} />;
}
/** Folded, and a proposal arrived since: the live dot. The ledge stays folded. */
export function FoldedNew() {
  return <FoldHandle counts={[{ count: 4, noun: "proposals" }]} form="words" folded fresh label="Show 4 proposals, 1 new" onToggle={toggle} />;
}
