import { useState, type ComponentProps } from "react";
import { JobList, type JobListItem } from "./JobList";
import { RunDetail } from "./RunDetail";
import { WatchToggle } from "./WatchToggle";

export const name = "Run detail";
export const note = "One build opened from its list: facts, one toned line, its watch, its parts";
export const composition = {
  default: [{ part: "src/ui/JobList.molecule.part.tsx", state: "default" }, { part: "src/ui/WatchToggle.atom.part.tsx", state: "OnWithWakes" }],
  Unread: [{ part: "src/ui/JobList.molecule.part.tsx", state: "Empty" }],
};

const runNumber = (value: number) => `#${String(value)}`;
const url = "https://github.com/forgerie/forgerie/actions/runs/18234561230";
const facts = [{ text: "fix/upload-retry", label: "Branch", code: true }, { text: "3f9a2c4", label: "Commit", code: true }, { text: "attempt 2", label: "Attempt" },
  { text: "push by simonwjackson", label: "Trigger" }, { text: "started 24m ago", label: "Started" }, { text: "took 12m", label: "Duration" }];
const log = "FAIL  src/upload.test.ts > upload > retries a dropped chunk\nAssertionError: expected 2 to be 3\nError: Process completed with exit code 1.";

/**
 * One opened build with its handlers on local state: back returns to a
 * stand-in list, the toggle flips the watch, and Unlink removes the build.
 */
function Scenario({ number, what, watching, wakes = 0, jobs, emptyJobs, ...detail }: Omit<ComponentProps<typeof RunDetail>, "back" | "watch" | "remove" | "children" | "number"> & {
  number: string; what: string; watching?: boolean | undefined; wakes?: number; jobs: JobListItem[]; emptyJobs: string;
}) {
  const [on, setOn] = useState(watching ?? false);
  const [place, setPlace] = useState<"open" | "list" | "unlinked">("open");
  if (place !== "open") return <p>{place === "list" ? `Back at the list of runs.` : `Unlinked run ${number}.`}{" "}
    <button type="button" onClick={() => setPlace("open")}>{place === "list" ? `Open run ${number}` : "Link it again"}</button></p>;
  return <RunDetail {...detail} number={number} back={{ label: "All runs", onPress: () => setPlace("list") }}
    watch={watching === undefined ? undefined : { note: on ? (wakes > 0 ? `Watching. The agent woke ${String(wakes)} times.` : "Watching. Nothing has woken the agent yet.")
      : "Wake the agent when a job fails, a new attempt starts, and when the run finishes.",
      control: <WatchToggle on={on} count={on ? wakes : undefined} text={on ? "Stop watching" : "Watch"} what={what} countText="wakes" onPress={() => setOn(!on)} /> }}
    remove={{ label: `Unlink run ${number} from this session.`, note: on ? "Its watch stops too." : undefined, onPress: () => setPlace("unlinked") }}>
    <JobList label="Jobs" empty={emptyJobs} linkText="Full job on GitHub" logLabel="Annotations" jobs={jobs} />
  </RunDetail>;
}

export default function Failed() {
  return <Scenario external={{ label: "Open on GitHub", href: url }} name="CI" number={runNumber(4812)} what={`run ${runNumber(4812)}`} watching wakes={2}
    title="Retry dropped upload chunks" facts={facts} state="failed" sentence="2 of 7 jobs failed in 12m." sectionTitle="Jobs" sectionCount="3 of 7 passed"
    emptyJobs="No job has started yet." jobs={[
      { id: "1", name: "test (ubuntu-latest, node 24)", state: "failed", stateText: "Failed", url, time: "6m 52s", share: 0.81, log },
      { id: "2", name: "test (macos-latest, node 24)", state: "failed", stateText: "Failed", url, time: "8m 26s", share: 1, log: "Error: The operation was canceled." },
      { id: "3", name: "lint", state: "passed", stateText: "Passed", url, time: "38s", share: 0.08 },
    ]} />;
}
export function Running() {
  return <Scenario external={{ label: "Open on GitHub", href: url }} name="Build SM8550" number={runNumber(4813)} what={`run ${runNumber(4813)}`} watching
    title="Build SM8550 firmware for the Fold 8" facts={facts.slice(0, 4)} state="running" sentence="In progress: 1 of 4 jobs done."
    notice={{ tone: "quiet", content: <p>Reading the jobs again from GitHub…</p> }} sectionTitle="Jobs" emptyJobs="No job has started yet." jobs={[
      { id: "1", name: "prepare", state: "passed", stateText: "Passed", url, time: "44s", share: 1 },
      { id: "2", name: "kernel", state: "running", stateText: "Running", url }, { id: "3", name: "sign", state: "queued", stateText: "Queued", url }]} />;
}
export function Unread() {
  return <Scenario name="Run" number="ID 18234488888" what="run ID 18234488888" title="Not read" facts={[]} state="unknown"
    sentence="Forgerie has not read this run." notice={{ tone: "warn", content: <><p>Forgerie's GitHub App needs <strong>Actions: read</strong> to read this run.</p>
      <p><a href="https://github.com/settings/apps/forgerie-dev/permissions">Grant it in the app's settings on GitHub</a>, then accept the new permissions on the app's installation.</p></> }}
    sectionTitle="Jobs" emptyJobs="Read the run to see its jobs." jobs={[]} />;
}
