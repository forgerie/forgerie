import { ExchangeLog, type ExchangeLine } from "./ExchangeLog";

export const name = "Exchange log";
export const note = "One worker's record: words with the speaker in the margin, actions, and folded output";

const LINES: ExchangeLine[] = [
  { kind: "said", key: "1", side: "in", speaker: "Task", text: "Add an empty state to the run list. Use the contract in `docs/runs.md`." },
  { kind: "call", key: "2", name: "read", summary: "docs/runs.md" },
  { kind: "output", key: "3", name: "read", isError: false, text: "# Runs\n\nGET /api/runs returns { runs: Run[] }.\nAn empty list means no run yet." },
  { kind: "call", key: "4", name: "bash", summary: "npm test -- runs" },
  { kind: "output", key: "5", name: "bash", isError: true, text: "FAIL src/runs/RunList.test.tsx\n  expected 'No runs yet' to be in the document" },
  { kind: "said", key: "6", side: "in", speaker: "You", text: "Keep the old copy; only add the icon." },
  { kind: "said", key: "7", side: "out", speaker: "ui", text: "Kept the copy and added the icon. **Tests pass.**" },
];

export default function Record() {
  return <ExchangeLog lines={LINES} empty="Nothing yet." />;
}
export function Streaming() {
  return <ExchangeLog follow empty="Nothing yet." lines={[...LINES.slice(0, 4), { kind: "said", key: "8", side: "out", speaker: "ui", text: "Reading the test output to find", streaming: true }]} />;
}
export function Empty() {
  return <ExchangeLog lines={[]} empty="Waiting for the first reply." />;
}
