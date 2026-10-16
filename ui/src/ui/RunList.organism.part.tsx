import { useState } from "react";
import { RunList } from "./RunList";
import { RunRow } from "./RunRow";

export const name = "Run list";
export const note = "A titled list of builds: skeleton rows first, one alert with retry, an empty text, and a foot";
export const composition = {
  default: [{ part: "src/ui/RunRow.molecule.part.tsx", state: "Running" }],
};

type Build = { id: number; state: "passed" | "failed" | "running"; title: string };
const BUILDS: readonly Build[] = [{ id: 4812, state: "failed", title: "Retry dropped upload chunks" }, { id: 4813, state: "running", title: "Bump vite" }, { id: 211, state: "passed", title: "Nightly" }];
const WORD = { passed: "Success", failed: "Failure", running: "In progress" } as const;

/**
 * The list with its handlers on local state: a row press opens that build
 * (its note says so), and Try again reads the builds in.
 */
function Scenario({ initial, loading = false, busy = false, failed = false, empty = false, foot = true }: {
  initial: readonly Build[]; loading?: boolean; busy?: boolean; failed?: boolean; empty?: boolean; foot?: boolean;
}) {
  const [builds, setBuilds] = useState(initial);
  const [alert, setAlert] = useState(failed);
  const [opened, setOpened] = useState<number>();
  return <RunList title="Linked runs" count={builds.length > 0 ? `${String(builds.length)} linked` : undefined} loading={loading} busy={busy}
    rows={builds.map((build) => ({ key: String(build.id), node: <RunRow state={build.state} stateText={WORD[build.state]} name="CI" title={build.title} age="2h"
      facts={[{ text: `#${String(build.id)}`, label: "Run number", code: true }, { text: "main", label: "Branch", code: true }]}
      note={opened === build.id ? "Opened." : undefined} open={{ label: `Open CI ${String(build.id)}`, onPress: () => setOpened(build.id) }} /> }))}
    alert={alert ? { text: <p>Forgerie could not read the runs. GitHub did not answer within 45 seconds.</p>,
      action: { label: "Try again", onPress: () => { setAlert(false); setBuilds(BUILDS); } } } : undefined}
    empty={empty ? <p><strong>No linked runs</strong>Link a workflow run to follow it here.</p> : undefined}
    foot={foot ? <p>Foot: the field that adds one.</p> : undefined} />;
}

export default function Rows() { return <Scenario initial={BUILDS} />; }
export function Loading() { return <Scenario initial={[]} loading />; }
export function Busy() { return <Scenario initial={BUILDS.slice(0, 1)} busy foot={false} />; }
export function Empty() { return <Scenario initial={[]} empty />; }
export function Failed() { return <Scenario initial={[]} failed foot={false} />; }
