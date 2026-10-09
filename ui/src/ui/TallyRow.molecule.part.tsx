import { TallyRow } from "./TallyRow";

export const name = "Tally row";
export const note = "Content with one toned mark per unit of work in its margin; the marks open the detail";

const lines = (items: readonly string[]) => items.map((item) => <p key={item}>{item}</p>);

export default function Narrated() {
  return <TallyRow marks={["plain", "plain", "bad", "plain", "plain"]} label="5 tool calls, 1 failed" title="bash, web_search ×2, web_fetch ×2 (1 failed)"
    sections={() => [{ key: "a", body: lines(["ran bash rg -n Quota internal", "failed web_fetch platform.openai.com/docs"]) }]}>
    <p>The meters read a router, so reset data would have to come through it. Let me find the router's quota code.</p>
  </TallyRow>;
}
export function Quiet() {
  return <TallyRow marks={["plain", "plain", "plain"]} label="3 tool calls" title="bash ×3" line="bash ls ~/.cli-proxy-api +2"
    sections={() => [{ key: "a", body: lines(["ran bash ls ~/.cli-proxy-api"]) }]} />;
}
export function Retried() {
  return <TallyRow marks={["plain", "warn"]} label="2 tool calls, 1 failed, then retried" title="write, bash (1 failed, then retried)"
    sections={() => [{ key: "a", notes: <p>Reuse the loader. Print reset fields only.</p>, body: lines(["wrote /tmp/probe/main.go", "failed bash go run /tmp/probe"]) }]}>
    <p>I'll write a read-only probe that reuses the router's own credential loader.</p>
  </TallyRow>;
}
export function Running() {
  return <TallyRow marks={["plain", "live"]} live label="2 tool calls" line="bash go run /tmp/probe-resets +1"
    sections={() => [{ key: "a", body: lines(["running bash go run /tmp/probe-resets"]) }]} />;
}
export function Stopped() {
  return <TallyRow marks={["plain", "faint"]} label="2 tool calls, 1 stopped" line="bash npm test +1" sections={() => [{ key: "a", body: lines(["stopped bash npm test"]) }]} />;
}
export function Grouped() {
  return <TallyRow marks={["plain", "plain", "plain", "plain", "bad"]} label="5 tool calls in 3 steps, 1 failed" title="read ×3, bash ×2 (1 failed)" line="read ×3, bash ×2"
    sections={() => [{ key: "a", body: lines(["ran read a.ts", "ran read b.ts"]) }, { key: "b", notes: <p>Check the config next.</p>, body: lines(["ran read c.ts"]) },
      { key: "c", body: lines(["ran bash npm test", "failed bash npm run lint"]) }]} />;
}
export function Overflow() {
  return <TallyRow marks={["plain", "plain", "plain", "plain", "plain", "plain", "plain", "plain", "plain", "plain", "bad", "plain"]}
    label="12 tool calls, 1 failed" title="read ×12 (1 failed)" sections={() => [{ key: "a", body: lines(["ran read a.ts"]) }]}>
    <p>Reading every module the router loads.</p>
  </TallyRow>;
}
