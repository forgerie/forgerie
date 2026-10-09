import { AsideList } from "./AsideList";

export const name = "Aside list";
export const note = "Findings outside the question, rated high, medium or low";

export default function Mixed() {
  return <AsideList code={"high: no live session has the guide until sessiond restarts\n  It started at 18:22, before the change.\nmedium: 13 block types may be too many for an agent to choose well\nlow: one gate fixture names the organism layer"} />;
}
export function One() {
  return <AsideList code={"low: the bundle grew 3 kB gzip"} />;
}
