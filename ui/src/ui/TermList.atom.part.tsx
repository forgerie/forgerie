import { TermList } from "./TermList";

export const name = "Term list";
export const note = "A few named values in two columns, each cut to two lines";

export default function Values() {
  return <TermList empty="Empty" terms={[
    { key: "task", term: "Task", value: "Move the settings page from its own fetches to the shared store. Keep every setting's current behaviour, and keep the old routes answering until the page moves." },
    { key: "base", term: "Branch to land on", value: "main" },
    { key: "rounds", term: "Review rounds", value: "2" },
  ]} />;
}
export function EmptyValue() {
  return <TermList empty="Empty" terms={[{ key: "suffix", term: "Suffix", value: "" }]} />;
}
