import { NumberedSections } from "./NumberedSections";

export const name = "Numbered sections";
export const note = "A document in sections whose headings carry the numbers of a list beside it, marked where the process stands";

const body = (text: string) => <p>{text}</p>;

export default function Plan() {
  return <NumberedSections overview={<p>The settings page fetches each setting on its own. This run moves the page and its API onto the shared store.</p>} sections={[
    { key: "shape", number: 1, title: "Shape", body: body("This chat writes the store's shape. No worker starts until you approve it.") },
    { key: "port", number: 2, title: "Port the API and the page", body: body("Two workers start at the same time, each on its own branch.") },
    { key: "notes", title: "Notes", body: body("Keep every control where it is.") },
  ]} />;
}
export function Running() {
  return <NumberedSections sections={[
    { key: "shape", number: 1, title: "Shape", mark: "done", body: body("This chat writes the store's shape.") },
    { key: "port", number: 2, title: "Port the API and the page", mark: "current", body: body("Two workers start at the same time.") },
    { key: "review", number: 3, title: "Review", body: body("A fresh reviewer reads both branches.") },
  ]} />;
}
export function Changed() {
  return <NumberedSections sections={[
    { key: "shape", title: "Shape", change: "removed", flag: "You removed this stage. The agent takes it out when it updates the plan.", body: body("This chat writes the store's shape.") },
    { key: "port", number: 1, title: "Port the API and the page", flag: "+ scout. The agent updates this section to match.", body: body("Two workers start at the same time.") },
    { key: "docs", number: 2, title: "Docs", change: "added", body: "The agent writes this section when it updates the plan." },
  ]} />;
}
