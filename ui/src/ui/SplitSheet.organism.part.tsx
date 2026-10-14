import { useState } from "react";
import { SplitSheet } from "./SplitSheet";
import { ActionFooter } from "./ActionFooter";
import { Lede } from "./Lede";

export const name = "Split sheet";
export const note = "A modal with a document and a rail beside it; one column below 50rem, with the foot in view at every size";

const paragraphs = Array.from({ length: 8 }, (_, index) => <p key={index}>Paragraph {index + 1} of the document. It reads at a measure of forty ems at most, and scrolls on its own beside the rail.</p>);

export default function Document() {
  return <SplitSheet title="Port settings to the shared store" subtitle={<><code>settings-store-port</code><span>4 stages</span></>} closeLabel="Close" onClose={() => {}}
    documentLabel="Document" document={<>{paragraphs}</>} railLabel="Rail" rail={<Lede>The rail holds what the reader sets before they act.</Lede>}
    foot={<ActionFooter note="Nothing happens until you start." actions={[{ label: "Dismiss", onPress: () => {} }, { label: "Start", tone: "primary", onPress: () => {} }]} />} />;
}
export function RailFirst() {
  return <SplitSheet title="A running process" subtitle="Working" closeLabel="Close" onClose={() => {}} railFirst
    lead={<Lede>Something that waits on the reader leads the sheet.</Lede>}
    documentLabel="Document" document={<>{paragraphs}</>} railLabel="Rail" rail={<Lede>In one column the rail comes first.</Lede>}
    foot={<ActionFooter note="Started 23 min ago." actions={[]} />} />;
}
/** Real handlers: the detail opens over the document, and Back closes it. */
export function Detail() {
  const [open, setOpen] = useState(true);
  return <SplitSheet title="A running process" closeLabel="Close" onClose={() => {}} detail={open} railFirst
    documentLabel="Document" document={open ? <div><button type="button" onClick={() => setOpen(false)}>Back</button>{paragraphs}</div> : <>{paragraphs}</>}
    railLabel="Rail" rail={<button type="button" onClick={() => setOpen(true)}>Open the detail</button>}
    foot={<ActionFooter note="The foot stays." actions={[]} />} />;
}
