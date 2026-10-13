import { DecisionCard } from "./DecisionCard";
import { ActionFooter } from "./ActionFooter";

export const name = "Decision card";
export const note = "Something in the thread that waits on the reader's decision, and says what was decided once closed";

export default function Open() {
  return <DecisionCard title="Contract" meta="Design, build, review" open
    footer={<ActionFooter note="Later stages start when you approve." actions={[
      { label: "Ask for changes", onPress: () => {} }, { label: "Approve", onPress: () => {}, tone: "primary" }]} />}>
    <p>The endpoint is GET /sessions/:id/child-runs.csv. Columns follow the run history sheet. The button has four states.</p>
  </DecisionCard>;
}
export function Failed() {
  return <DecisionCard title="Contract" meta="Design, build, review" open
    problem="The server did not answer in time. Nothing was approved."
    footer={<ActionFooter actions={[{ label: "Ask for changes", onPress: () => {} }, { label: "Retry", onPress: () => {}, tone: "primary" }]} />}>
    <p>The endpoint is GET /sessions/:id/child-runs.csv. Columns follow the run history sheet.</p>
  </DecisionCard>;
}
export function ClosedWithLink() {
  return <DecisionCard title="Contract" meta="Design, build, review" open={false}
    closed="Saved as docs/contracts/run-export.md" closedHref="https://example.com/docs/contracts/run-export.md" />;
}
export function Closed() {
  return <DecisionCard title="Contract" meta="Design, build, review" open={false} closed="Approved by you.">
    <p>The endpoint is GET /sessions/:id/child-runs.csv. Columns follow the run history sheet.</p>
  </DecisionCard>;
}
export function OneAction() {
  return <DecisionCard title="settings-store-port" meta="Proposed workflow" open action={{ label: "Review", onPress: () => {} }}
    footer={<ActionFooter note="4 stages · 3 workers · 2 stops" actions={[]} />}>
    <p>Port the settings page to the shared store: agree the shape, move the API and the page in parallel, then a fresh review.</p>
  </DecisionCard>;
}
export function PinnedChoices() {
  return <DecisionCard title="Publish 0.4.0 to npm" meta="Publish" open pinChoices
    footer={<ActionFooter actions={[{ label: "Refuse", onPress: () => {} }, { label: "Approve and run", onPress: () => {}, tone: "primary" }]} />}>
    <p>The choices sit beside the title in a short container, and the body follows them.</p>
  </DecisionCard>;
}
export function ClosedFailed() {
  return <DecisionCard title="Publish 0.4.0 to npm" meta="Publish" open={false} closedTone="bad"
    closed="Approved — failed: npm ERR! 403 You cannot publish over the previously published version 0.4.0."
    closedDetail={<p>The registry keeps every published version.</p>}>
    <p>The body stays above the closed line.</p>
  </DecisionCard>;
}
