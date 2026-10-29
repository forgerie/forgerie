import { AwayNote } from "./AwayNote";

export const name = "Away note";
export const note = "A two or three sentence catch-up for a returning reader, with one live line when something waits on them";

const summary = "Finding what Grok Bot can do that the core assistant cannot. The gap table is done; the browser PATH fix is written but not deployed. Next is choosing between the PATH fix and the notes correction.";
export default function Resting() { return <AwayNote title="While you were away" summary={summary} />; }
export function NeedsYou() { return <AwayNote title="While you were away" summary={summary} needs="Approve git push origin main" />; }
export function LongWord() { return <AwayNote title="While you were away" summary={`Fixed /home/${"longunbrokenpath".repeat(12)} and it is not deployed.`} />; }
export function NeedsOnly() { return <AwayNote title="While you were away" summary="" needs="Answer the open question form." />; }
