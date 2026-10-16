import { JobList, type JobListItem } from "./JobList";

export const name = "Job list";
export const note = "The jobs of one build: mark, name, time over a ribbon of its share; output opens in place";

const log = "FAIL  src/upload.test.ts > upload > retries a dropped chunk\nAssertionError: expected 2 to be 3\n ❯ src/upload.test.ts:48:23\nError: Process completed with exit code 1.";
const url = "https://github.com/forgerie/forgerie/actions/runs/18234561230/job/1";
const jobs: JobListItem[] = [
  { id: "1", name: "test (ubuntu-latest, node 24)", state: "failed", stateText: "Failed", url, time: "6m 52s", share: 0.81, log },
  { id: "2", name: "e2e (chromium)", state: "cancelled", stateText: "Cancelled", url, time: "1m 35s", share: 0.19 },
  { id: "3", name: "kernel", state: "running", stateText: "Running", url },
  { id: "4", name: "sign", state: "queued", stateText: "Queued", url },
  { id: "5", name: "test (macos-latest, node 24)", state: "passed", stateText: "Passed", url, time: "8m 26s", share: 1 },
  { id: "6", name: "lint", state: "passed", stateText: "Passed", url, time: "38s", share: 0.08 },
  { id: "7", name: "publish preview", state: "skipped", stateText: "Skipped", url },
];
const fold = { states: ["passed", "skipped"] as const, closed: "3 passed or skipped", open: "Hide the passed and skipped jobs" };
export default function Mixed() {
  return <JobList label="Jobs" jobs={jobs} empty="No job has started yet." linkText="Full job on GitHub" logLabel="Annotations" fold={fold} />;
}
export function Unfolded() {
  return <JobList label="Jobs" jobs={jobs} empty="No job has started yet." linkText="Full job on GitHub" logLabel="Annotations" />;
}
export function Empty() {
  return <JobList label="Jobs" jobs={[]} empty="No job has started yet." linkText="Full job on GitHub" logLabel="Annotations" />;
}
export function Many() {
  const matrix: JobListItem[] = Array.from({ length: 30 }, (_, index) => ({ id: String(index), name: `test (shard ${String(index + 1)} of 30, a-really-long-matrix-value-without-breaks)`,
    state: index === 7 ? "failed" : "passed", stateText: index === 7 ? "Failed" : "Passed", url, time: `${String(40 + index * 7)}s`, share: (40 + index * 7) / 243, ...index === 7 ? { log } : {} }));
  return <JobList label="Jobs" jobs={matrix} empty="No job has started yet." linkText="Full job on GitHub" logLabel="Annotations" />;
}
