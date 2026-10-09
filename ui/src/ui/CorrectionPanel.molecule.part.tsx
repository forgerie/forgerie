import { CorrectionPanel } from "./CorrectionPanel";

export const name = "Correction panel";
export const note = "What an earlier reply got wrong, what is true, and why";

export default function Full() {
  return <CorrectionPanel code={"was: the guide adds 4,000 tokens to every message\nnow: it adds about 1,100 tokens to each model call, mostly cached\ncause: I showed its size in characters next to a cost in tokens"} />;
}
export function NoCause() {
  return <CorrectionPanel code={"was: `npm run verify` passed\nnow: two root tests timed out under load"} />;
}
