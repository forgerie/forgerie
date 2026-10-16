import { StageMarks } from "./StageMarks";

export const name = "Stage marks";
export const note = "A plan's steps in tally marks: outlined marks per unit it will start, a ringed mark where the reader decides";

export default function Plan() {
  return <StageMarks stages={[{ name: "Contract", marks: 0, stop: true }, { name: "Design and build", marks: 2 }, { name: "Review", marks: 2 }, { name: "Land", marks: 0, stop: true }]} />;
}
/** Seven steps wrap onto more lines instead of being cut. */
export function Long() {
  return <StageMarks stages={[{ name: "Establish scope", marks: 1 }, { name: "Explore responsibilities", marks: 3 }, { name: "Implement and test", marks: 1 },
    { name: "Independently review", marks: 1 }, { name: "Explain completed work", marks: 1 }, { name: "Approve landing", marks: 0, stop: true }, { name: "Rebase, verify, and fast-forward", marks: 0 }]} />;
}
