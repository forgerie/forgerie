import { DetailPane } from "./DetailPane";
import { TextButton } from "./TextButton";

export const name = "Detail pane";
export const note = "One item opened in a pane: a way back, title and status, a bar, a body that scrolls, and a foot";

const lines = Array.from({ length: 12 }, (_, index) => <p key={index}>Line {index + 1} of the record. It scrolls inside the pane, and the header and the foot stay put.</p>);

export default function Open() {
  return <DetailPane back={{ label: "Plan", onPress: () => {} }} title={<code>api</code>} status="Working for 9 min" label="api's record"
      actions={<TextButton label="Stop" tone="danger" onPress={() => {}} />} bar={<span>Model: Claude Sonnet 5</span>} foot={<p>A reply box goes here.</p>}>
    {lines}
  </DetailPane>;
}
export function Plain() {
  return <DetailPane back={{ label: "Back", onPress: () => {} }} title="An item" label="The item">
    <p>Only a body.</p>
  </DetailPane>;
}
