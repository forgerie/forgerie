import { useState } from "react";
import { JobList } from "./JobList";
import { RunDetail } from "./RunDetail";
import { WatchToggle } from "./WatchToggle";

export const name = "Run detail";
export const note = "One build opened from its list: facts, one toned line, its watch, its parts";
export const composition = {
  default: [{ part: "src/ui/JobList.molecule.part.tsx", state: "default" }, { part: "src/ui/WatchToggle.atom.part.tsx", state: "OnWithWakes" }],
  Unread: [{ part: "src/ui/JobList.molecule.part.tsx", state: "Empty" }],
};

const url = "https://github.com/forgerie/forgerie/actions/runs/18234561230";
const facts = [{ text: "fix/upload-retry", label: "Branch", code: true }, { text: "3f9a2c4", label: "Commit", code: true }, { text: "attempt 2", label: "Attempt" },
  { text: "push by simonwjackson", label: "Trigger" }, { text: "started 24m ago", label: "Started" }, { text: "took 12m", label: "Duration" }];
const log = "FAIL  src/upload.test.ts > upload > retries a dropped chunk\nAssertionError: expected 2 to be 3\nError: Process completed with exit code 1.";

function Scenario() {
  const [on, setOn] = useState(true);
  const [back, setBack] = useState(0);
  return <RunDetail back={{ label: back > 0 ? `All runs (pressed ${String(back)})` : "All runs", onPress: () => setBack(back + 1) }} external={{ label: "Open on GitHub", href: url }}
    name="CI" number="#18234561230" title="Retry dropped upload chunks" facts={facts} state="failed" sentence="2 of 7 jobs failed in 12m."
    watch={{ note: on ? "Watching. The agent woke 2 times." : "Wake the agent when a job fails, a new attempt starts, and when the run finishes.",
      control: <WatchToggle on={on} count={on ? 2 : undefined} text={on ? "Stop watching" : "Watch"} what="run #18234561230" countText="wakes" onPress={() => setOn(!on)} /> }}
    sectionTitle="Jobs" sectionCount="3 of 7 passed" remove={{ label: "Unlink run #18234561230 from this session.", note: on ? "Its watch stops too." : undefined, onPress: () => {} }}>
    <JobList label="Jobs" empty="No job has started yet." linkText="Full job on GitHub" logLabel="Annotations" jobs={[
      { id: "1", name: "test (ubuntu-latest, node 24)", state: "failed", stateText: "Failed", url, time: "6m 52s", share: 0.81, log },
      { id: "2", name: "test (macos-latest, node 24)", state: "failed", stateText: "Failed", url, time: "8m 26s", share: 1, log: "Error: The operation was canceled." },
      { id: "3", name: "lint", state: "passed", stateText: "Passed", url, time: "38s", share: 0.08 },
    ]} />
  </RunDetail>;
}
export default function Failed() { return <Scenario />; }
export function Running() {
  return <RunDetail back={{ label: "All runs", onPress: () => {} }} external={{ label: "Open on GitHub", href: url }} name="Build SM8550" number="#18234590417"
    title="Build SM8550 firmware for the Fold 8" facts={facts.slice(0, 4)} state="running" sentence="In progress: 1 of 4 jobs done."
    notice={{ tone: "quiet", content: <p>Reading the jobs again from GitHub…</p> }}
    watch={{ note: "Watching. Nothing has woken the agent yet.", control: <WatchToggle on text="Stop watching" what="run #18234590417" onPress={() => {}} /> }} sectionTitle="Jobs">
    <JobList label="Jobs" empty="No job has started yet." linkText="Full job on GitHub" logLabel="Annotations" jobs={[
      { id: "1", name: "prepare", state: "passed", stateText: "Passed", url, time: "44s", share: 1 },
      { id: "2", name: "kernel", state: "running", stateText: "Running", url }, { id: "3", name: "sign", state: "queued", stateText: "Queued", url }]} />
  </RunDetail>;
}
export function Unread() {
  return <RunDetail back={{ label: "All runs", onPress: () => {} }} name="Run" number="#18234488888" title="Not read" facts={[]} state="unknown"
    sentence="Forgerie has not read this run." notice={{ tone: "warn", content: <><p>Forgerie's GitHub App needs <strong>Actions: read</strong> to read this run.</p>
      <p><a href="https://github.com/settings/apps/forgerie-dev/permissions">Grant it in the app's settings on GitHub</a>, then accept the new permissions on the app's installation.</p></> }}
    sectionTitle="Jobs" remove={{ label: "Unlink run #18234488888 from this session.", onPress: () => {} }}>
    <JobList label="Jobs" jobs={[]} empty="Read the run to see its jobs." linkText="Full job on GitHub" logLabel="Annotations" />
  </RunDetail>;
}
