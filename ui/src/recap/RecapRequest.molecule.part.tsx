import { RecapRequest } from "./RecapRequest";
export const name = "Recap request";
export default function Writing() { return <RecapRequest state={{ kind: "writing" }} />; }
export function Failed() { return <RecapRequest state={{ kind: "failed", message: "Could not write a recap. Try /recap again." }} />; }
