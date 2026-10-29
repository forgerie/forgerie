import { RuledBrief } from "./RuledBrief";

export const name = "Ruled brief";
export const note = "Two or three sentences set apart from the reply by a start rule, with one live line when something waits on the reader";

const text = "Finding what Grok Bot can do that the core assistant cannot. The gap table is done; the browser PATH fix is written but not deployed. Next is choosing between the PATH fix and the notes correction.";
export default function Resting() { return <RuledBrief title="While you were away" text={text} />; }
export function Urgent() { return <RuledBrief title="While you were away" text={text} urgent={{ label: "Needs you", text: "Approve git push origin main" }} />; }
export function LongWord() { return <RuledBrief title="While you were away" text={`Fixed /home/${"longunbrokenpath".repeat(12)} and it is not deployed.`} />; }
export function UrgentOnly() { return <RuledBrief title="While you were away" text="" urgent={{ label: "Needs you", text: "Answer the open question form." }} />; }
