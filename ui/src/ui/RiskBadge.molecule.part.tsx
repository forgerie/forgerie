import { RiskBadge } from "./RiskBadge";

export const name = "Risk badge";
export const note = "An outside opinion of an action's risk: low is muted, check draws the eye, danger warns; the raised signals and the source are text";

export default function Danger() {
  return <RiskBadge level="danger" word="High risk" reasons={["deletes data", "outside the working directory", "acts as you"]} source="Opinion from fast" size="block" />;
}
export function Check() {
  return <RiskBadge level="check" word="Check first" reasons={["acts as you"]} source="Opinion from fast" size="block" />;
}
/** Muted and neutral: an opinion of low risk is not a clearance. */
export function Low() {
  return <RiskBadge level="low" word="Low risk" reasons={[]} source="Opinion from fast" size="block" />;
}
/** A long model name wraps instead of widening the card. */
export function LongSource() {
  return <RiskBadge level="check" word="Check first" reasons={["deletes data", "outside the working directory"]}
    source="Opinion from claude-haiku-4-5-20251001-with-a-long-gateway-alias" size="block" />;
}
/** At the end of a one-line row: the reasons are hover and screen-reader text. */
export function Inline() {
  return <p>
    <RiskBadge level="low" word="Low risk" reasons={[]} source="Opinion from fast" size="inline" />{" "}
    <RiskBadge level="check" word="Check first" reasons={["deletes data"]} source="Opinion from fast" size="inline" />{" "}
    <RiskBadge level="danger" word="High risk" reasons={["deletes data", "acts as you"]} source="Opinion from fast" size="inline" />
  </p>;
}
