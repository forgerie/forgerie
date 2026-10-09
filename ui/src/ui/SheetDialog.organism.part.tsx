import { SheetDialog } from "./SheetDialog";

export const name = "Sheet dialog";
export const note = "A modal sheet that is a card with room and meets the edges without it";

export default function WithFooter() {
  return <SheetDialog title="Child agents" subtitle="3 children, 1 working" closeLabel="Close" onClose={() => {}}
    footer={<p>Footer content stays in view.</p>}>
    <p>The body scrolls on its own when it is longer than the sheet.</p>
  </SheetDialog>;
}
export function WithBack() {
  return <SheetDialog title="ui" subtitle="design-engineer, working" closeLabel="Close" onClose={() => {}}
    back={{ label: "All child agents", onPress: () => {} }}>
    <p>One item, with a way back to the list.</p>
  </SheetDialog>;
}
