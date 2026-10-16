import { useState } from "react";
import { ShieldCheckIcon } from "lucide-react";
import { DisclosureRow } from "./DisclosureRow";

export const name = "Disclosure row";
export const note = "One list line that opens in place: a mark, a title, a quieter line, a trail of status, count and age";

function Lines({ first = false }: { first?: boolean }) {
  const [open, setOpen] = useState(first);
  const [second, setSecond] = useState(false);
  return <ul>
    <DisclosureRow icon={<ShieldCheckIcon aria-hidden />} title="Push Git refs with unknown default branch" status="Approved" count={3} time="3h, 16h, 17h"
      open={open} onToggle={() => setOpen(!open)} note="It already ran. A note changes what comes next, not what happened.">
      <p>Each of the three in full.</p>
    </DisclosureRow>
    <DisclosureRow icon={<ShieldCheckIcon aria-hidden />} title="Should the CSV include archived runs?" line="The contract lists active runs only, and the task says nothing about archived ones."
      status="Overturned" struck time="1h" open={second} onToggle={() => setSecond(!second)}><p>The record in full.</p></DisclosureRow>
  </ul>;
}
export default function Closed() { return <Lines />; }
export function Open() { return <Lines first />; }
