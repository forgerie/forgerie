import { useState } from "react";
import { MenuButton } from "./MenuButton";
import { ActionRow } from "./ActionRow";

export const name = "Action row";
export const note = "A list item that is not a link, with its commands at the end";

export default function Ready() {
  const [status, setStatus] = useState("Open");
  return <ul>
    <ActionRow name="letters" status={status} detail={<code>/home/reader/letters/drafts-2026</code>}
      actions={<MenuButton label="Commands for letters" commands={[{ label: "Close", onSelect: () => setStatus("Closed") }]} />} />
  </ul>;
}
export function Failed() {
  return <ul><ActionRow name="a-folder-with-a-very-long-name-that-has-to-wrap" status="Cleanup failed" tone="danger"
    detail="The folder is still in use by another program." /></ul>;
}
