import { PageSection } from "./PageSection";

export const name = "Page section";
export const note = "A titled part of a document page";

export default function Inputs() {
  return <PageSection title="Inputs"><p>Refine the three oldest ready backlog items.</p></PageSection>;
}
export function WithProblem() {
  return <PageSection title="Inputs" problem="Fill in task."><p>Task</p></PageSection>;
}
