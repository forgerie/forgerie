import { RailSection } from "./RailSection";

export const name = "Rail section";
export const note = "Supporting content set quiet on a hairline, closed by a labelled rule before the main text";

export default function Closed() {
  return <>
    <RailSection end="20 tool calls, 1 failed">
      <p>The meters read a router, so reset data would have to come through it.</p>
      <p>Let me check the live router payload.</p>
    </RailSection>
    <p>Yes. Both providers report when each quota window resets.</p>
  </>;
}
export function Open() {
  return <RailSection>
    <p>Credentials live in <code>~/.cli-proxy-api</code>. I'll write a read-only probe.</p>
  </RailSection>;
}
export function LongLabel() {
  return <>
    <RailSection end="401 tool calls, 12 failed, 3 stopped, in a reply that ran for a long time">
      <p>Reading every module the router loads.</p>
    </RailSection>
    <p>Done.</p>
  </>;
}
