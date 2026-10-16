import { useState, type ComponentProps } from "react";
import { MenuButton } from "./MenuButton";
import { RunRow } from "./RunRow";
import { WatchToggle } from "./WatchToggle";

export const name = "Run row";
export const note = "One build in a list: mark, name and title, age, state and facts, controls that drop under the text";

/** A run number is a readout like any other; it is built here so it never reads as a colour literal. */
const runNumber = (value: number) => `#${String(value)}`;
const facts = [{ text: runNumber(4812), label: "Run number", code: true }, { text: "fix/upload-retry", label: "Branch", code: true },
  { text: "3f9a2c4", label: "Commit", code: true }, { text: "attempt 2", label: "Attempt" }];

/**
 * One row with its handlers on local state: a press opens it (the note says
 * so), the toggle flips the watch, and Unlink takes the row away until the
 * reader links it again.
 */
function Scenario({ label, watch, ...row }: Omit<ComponentProps<typeof RunRow>, "open" | "controls"> & {
  label: string; watch?: { on: boolean; count?: number; what: string } | undefined;
}) {
  const [on, setOn] = useState(watch?.on ?? false);
  const [opened, setOpened] = useState(0);
  const [linked, setLinked] = useState(true);
  if (!linked) return <p>Unlinked {row.name}. <button type="button" onClick={() => setLinked(true)}>Link it again</button></p>;
  return <RunRow {...row} note={opened > 0 ? `Opened ${String(opened)} ${opened === 1 ? "time" : "times"}.` : row.note}
    open={{ label, onPress: () => setOpened(opened + 1) }}
    controls={<>
      {watch ? <WatchToggle on={on} text={on ? "Watching" : "Watch"} count={on ? watch.count : undefined} what={watch.what} countText="wakes" onPress={() => setOn(!on)} /> : null}
      <MenuButton label={`More for ${row.name}`} commands={[{ label: "Unlink from this session", tone: "danger", onSelect: () => setLinked(false) }]} />
    </>} />;
}

export default function Failed() {
  return <Scenario state="failed" stateText="Failure" name="CI" title="Retry dropped upload chunks" facts={facts} age="24m" ageLabel="Started 11:36"
    label="Open CI" watch={{ on: true, count: 2, what: `run ${runNumber(4812)}` }} />;
}
export function Running() {
  return <Scenario state="running" stateText="In progress" name="Build SM8550" title="Build SM8550 firmware for the Fold 8" age="9m" facts={facts.slice(0, 3)}
    label="Open Build SM8550" watch={{ on: false, what: `run ${runNumber(4813)}` }} />;
}
export function Stopped() {
  return <Scenario state="passed" stateText="Success" name="CI" title="Retry dropped upload chunks" age="3h" facts={facts}
    label="Open CI" note="Stopped: run completed (success)." />;
}
export function OnGitHub() {
  return <RunRow state="queued" stateText="Queued" name="CodeQL" title="Retry dropped upload chunks" age="<1m" facts={facts.slice(0, 3)}
    open={{ label: "CodeQL on GitHub", href: "https://github.com/forgerie/forgerie/actions/runs/18234561231" }} />;
}
export function Unread() {
  return <Scenario state="unknown" stateText="Not read" name="Run ID 18234499999" facts={[]} label="Open run" watch={{ on: false, what: "run ID 18234499999" }}
    problem={{ tone: "bad", content: <p>Forgerie could not read this run. GitHub answered 404: Not Found.</p> }} />;
}
export function Permission() {
  return <Scenario state="unknown" stateText="Not read" name="Run ID 18234488888" facts={[]} label="Open run" watch={{ on: true, count: 1, what: "run ID 18234488888" }}
    problem={{ tone: "warn", content: <><p>Forgerie's GitHub App needs <strong>Actions: read</strong> to read this run.</p>
      <p><a href="https://github.com/settings/apps/forgerie-dev/permissions">Grant it in the app's settings on GitHub</a>, then accept the new permissions on the app's installation.</p></> }} />;
}
export function LongValues() {
  return <Scenario state="failed" stateText="Timed out" name="Build and publish signed firmware images for every supported board revision"
    title="Rework the partition table so that the recovery image and the vendor image can grow independently without a reflash" age="1w"
    facts={[{ text: runNumber(128734), label: "Run number", code: true }, { text: "feature/partition-table-rework-for-independently-growing-recovery-and-vendor-images", label: "Branch", code: true },
      { text: "3f9a2c4", label: "Commit", code: true }, { text: "attempt 12", label: "Attempt" }]}
    label="Open the long run" watch={{ on: true, count: 128, what: `run ${runNumber(128734)}` }} />;
}
