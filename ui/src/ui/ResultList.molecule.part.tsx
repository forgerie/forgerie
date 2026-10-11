import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { HitRow } from "./HitRow";
import { ResultList, type ResultListRow } from "./ResultList";

export const name = "Result list";
export const note = "The answers to a search: progress, failure, skeleton, busy, empty, and more to load";
export const checks = {
  More: {
    "Show more adds the next rows": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "Show more" }));
      expect(canvas.getByText("Bed 6")).toBeVisible();
    },
  },
} satisfies StateChecks;
export const composition = { default: [{ part: "src/ui/HitRow.molecule.part.tsx", state: "default" }] };

const row = (index: number): ResultListRow => ({ key: String(index), node: <HitRow title={`Bed ${String(index)}`} where="garden" time={`${String(index)}d`}
  passage={`Bed ${String(index)} needs compost before the tomatoes go in.`} marks={[[35, 43]]} onPress={() => undefined} /> });
const ROWS = [1, 2, 3].map(row);

export default function Rows() {
  return <ResultList label="Found beds" rows={ROWS} />;
}
export function Loading() {
  return <ResultList label="Found beds" rows={[]} loading />;
}
/** Old rows stay under a busy mark while a newer answer comes. */
export function Busy() {
  return <ResultList label="Found beds" rows={ROWS} busy />;
}
export function Empty() {
  return <ResultList label="Found beds" rows={[]} empty={<p>No bed matches “compost”</p>} />;
}
export function Gathering() {
  return <ResultList label="Found beds" rows={ROWS} progress={{ text: "Reading 4,210 of 13,719 beds — newer beds first", value: 4210, max: 13_719 }} />;
}
export function Failed() {
  const [tries, setTries] = useState(0);
  return <ResultList label="Found beds" rows={[]} alert={{ text: tries === 0 ? "The garden log is not ready yet." : `Still not ready after ${String(tries)} tries.`,
    action: { label: "Retry", onPress: () => setTries(tries + 1) } }} />;
}
export function More() {
  const [rows, setRows] = useState(ROWS);
  return <ResultList label="Found beds" rows={rows}
    more={rows.length < 6 ? { label: "Show more", onPress: () => setRows([...rows, ...[4, 5, 6].map(row)]) } : undefined} />;
}
export function MoreLoading() {
  return <ResultList label="Found beds" rows={ROWS} more={{ label: "Loading more…", busy: true, onPress: () => undefined }} />;
}
