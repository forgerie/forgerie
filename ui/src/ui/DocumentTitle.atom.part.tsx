import { DocumentTitle } from "./DocumentTitle";

export const name = "Document title";
export const note = "A document's title and standfirst, read before it is edited";

export default function WithStandfirst() {
  return <DocumentTitle title="Nightly maintenance"
    standfirst="Fix failing tests, keep checks fast, and simplify code overnight so the user never wakes up worse off; land only after approval." />;
}
export function TitleOnly() { return <DocumentTitle title="Weekly release notes" />; }
export function LongTitle() {
  return <DocumentTitle title="Refine the oldest ready backlog items in every registered project and open one land card for each" />;
}
