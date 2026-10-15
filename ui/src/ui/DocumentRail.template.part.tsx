import { DocumentRail } from "./DocumentRail";

export const name = "Document rail";
export const note = "A document with a side panel beside it while wide, and between the head and the text while narrow";

const PARAGRAPH = "Each paragraph here stands for the document's text, at a reading measure. A narrow container moves the panel above it.";

export default function WithPanel() {
  return <DocumentRail railLabel="Settings" head={<><h2>Document title</h2><p>A standfirst under the title says what the document is for.</p></>}
    rail={<><h3>Settings</h3><p>Repeat: every day</p><p>Time: 1:00 AM</p><h3>Route</h3><p>1. Measure</p><p>2. Review</p></>}>
    <p>{PARAGRAPH}</p><p>{PARAGRAPH}</p><p>{PARAGRAPH}</p>
  </DocumentRail>;
}
/** A notice closes the head, so a narrow column reads it before the panel. */
export function WithNotice() {
  return <DocumentRail railLabel="Settings" head={<h2>Document title</h2>}
    notices={[<p key="notice">Line 5 of the file has an error. The last good version runs meanwhile.</p>]}
    rail={<><h3>Settings</h3><p>Repeat: every day</p></>}>
    <p>{PARAGRAPH}</p>
  </DocumentRail>;
}
