import { PageSection } from "./PageSection";

export const name = "Page section";
export const note = "A titled part of a document page";

export default function Inputs() {
  return <PageSection title="Inputs"><p>Refine the three oldest ready backlog items.</p></PageSection>;
}
export function WithProblem() {
  return <PageSection title="Inputs" problem="Fill in task."><p>Task</p></PageSection>;
}
/** In a side panel, with a toggle at the heading's end. */
export function PanelWithAction() {
  return <div>
    <PageSection title="Schedule" spacing="panel" action={{ label: "Pause", onPress: () => undefined }}><p>Every day at 1:00 AM.</p></PageSection>
    <PageSection title="Inputs" spacing="panel"><p>Most improvements per night: 2</p></PageSection>
  </div>;
}
