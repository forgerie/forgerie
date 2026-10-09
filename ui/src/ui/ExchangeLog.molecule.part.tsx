import { ExchangeLog, type ExchangeLine } from "./ExchangeLog";

export const name = "Exchange log";
export const note = "One worker's record: bubbles for words to it, prose for its words, a rail for its work";

const LINES: ExchangeLine[] = [
  { kind: "in", key: "1", label: "Task", text: "Add an empty state to the run list. Use the contract in `docs/runs.md`." },
  { kind: "call", key: "2", name: "read", summary: "docs/runs.md" },
  { kind: "output", key: "3", name: "read", isError: false, text: "# Runs\n\nGET /api/runs returns { runs: Run[] }.\nAn empty list means no run yet." },
  { kind: "call", key: "4", name: "bash", summary: "npm test -- runs" },
  { kind: "output", key: "5", name: "bash", isError: true, text: "FAIL src/runs/RunList.test.tsx\n  expected 'No runs yet' to be in the document" },
  { kind: "in", key: "6", label: "You", text: "Keep the old copy; only add the icon." },
  { kind: "out", key: "7", text: "Kept the copy and added the icon. **Tests pass.**" },
];

export default function Record() {
  return <ExchangeLog lines={LINES} empty="Nothing yet." />;
}
export function Streaming() {
  return <ExchangeLog follow empty="Nothing yet." lines={[...LINES.slice(0, 4), { kind: "out", key: "8", text: "Reading the test output to find which assertion", streaming: true }]} />;
}
export function Empty() {
  return <ExchangeLog lines={[]} empty="Waiting for the first reply." />;
}
