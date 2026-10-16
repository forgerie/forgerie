import { VerdictLine } from "./VerdictLine";

export const name = "Verdict line";
export const note = "A yes, no or partly answer with its reason, readable at a glance and without colour";

export default function Yes() {
  return <VerdictLine code={"yes: The code is on main as `721dd29a` and the running web unit serves it."} />;
}
export function No() {
  return <VerdictLine code={"no: The USB is still syncing; 236 MB left, about 13 minutes."} />;
}
export function Partly() {
  return <VerdictLine code={"partly: The mockup is on main, but the full implementation has not started."} />;
}
export function Arriving() {
  return <VerdictLine code={"partly: The mockup is on main, but t"} />;
}
