import { useState } from "react";
import { RunRow } from "./RunRow";
import { WatchToggle } from "./WatchToggle";

export const name = "Run row";
export const note = "One build in a list: mark, name and title, age, state and facts, controls that drop under the text";

/** A run number is a readout like any other; it is built here so it never reads as a colour literal. */
const runNumber = (value: number) => `#${String(value)}`;
const facts = [{ text: runNumber(4812), label: "Run number", code: true }, { text: "fix/upload-retry", label: "Branch", code: true },
  { text: "3f9a2c4", label: "Commit", code: true }, { text: "attempt 2", label: "Attempt" }];

function Watched({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [opened, setOpened] = useState(0);
  return <RunRow state="failed" stateText="Failure" name="CI" title="Retry dropped upload chunks" facts={facts} age="24m" ageLabel="Started 11:36"
    open={{ label: `Open CI run, opened ${String(opened)} times`, onPress: () => setOpened(opened + 1) }}
    controls={<WatchToggle on={on} text={on ? "Watching" : "Watch"} count={on ? 2 : undefined} what={`run ${runNumber(4812)}`} countText="wakes" onPress={() => setOn(!on)} />} />;
}
export default function Failed() { return <Watched initial />; }
export function Running() {
  return <RunRow state="running" stateText="In progress" name="Build SM8550" title="Build SM8550 firmware for the Fold 8" age="9m" facts={facts.slice(0, 3)}
    open={{ label: "Open Build SM8550", onPress: () => {} }} controls={<WatchToggle on={false} text="Watch" what={`run ${runNumber(4812)}`} countText="wakes" onPress={() => {}} />} />;
}
export function Stopped() {
  return <RunRow state="passed" stateText="Success" name="CI" title="Retry dropped upload chunks" age="3h" facts={facts}
    open={{ label: "Open CI", onPress: () => {} }} note="Stopped: run completed (success)." />;
}
export function OnGitHub() {
  return <RunRow state="queued" stateText="Queued" name="CodeQL" title="Retry dropped upload chunks" age="<1m" facts={facts.slice(0, 3)}
    open={{ label: "CodeQL on GitHub", href: "https://github.com/forgerie/forgerie/actions/runs/18234561231" }} />;
}
export function Unread() {
  return <RunRow state="unknown" stateText="Not read" name="Run ID 18234499999" facts={[]} open={{ label: "Open run", onPress: () => {} }}
    problem={{ tone: "bad", content: <p>Forgerie could not read this run. GitHub answered 404: Not Found.</p> }} />;
}
export function Permission() {
  return <RunRow state="unknown" stateText="Not read" name="Run ID 18234488888" facts={[]} open={{ label: "Open run", onPress: () => {} }}
    problem={{ tone: "warn", content: <><p>Forgerie's GitHub App needs <strong>Actions: read</strong> to read this run.</p>
      <p><a href="https://github.com/settings/apps/forgerie-dev/permissions">Grant it in the app's settings on GitHub</a>, then accept the new permissions on the app's installation.</p></> }} />;
}
export function LongValues() {
  return <RunRow state="failed" stateText="Timed out" name="Build and publish signed firmware images for every supported board revision"
    title="Rework the partition table so that the recovery image and the vendor image can grow independently without a reflash" age="1w"
    facts={[{ text: runNumber(128734), label: "Run number", code: true }, { text: "feature/partition-table-rework-for-independently-growing-recovery-and-vendor-images", label: "Branch", code: true },
      { text: "3f9a2c4", label: "Commit", code: true }, { text: "attempt 12", label: "Attempt" }]}
    open={{ label: "Open the long run", onPress: () => {} }} controls={<WatchToggle on text="Watching" count={128} what={`run ${runNumber(128734)}`} countText="wakes" onPress={() => {}} />} />;
}
