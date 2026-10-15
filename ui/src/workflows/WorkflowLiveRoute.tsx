import { useState } from "react";
import { RouteList, type RouteLine, type RouteListItem } from "../ui/RouteList";
import type { SessionModel } from "../contracts";
import { modelName } from "./workflowRoute";
import { defaultModelLabel } from "./WorkerModelPicker";
import type { LiveStage, LiveWorker } from "./workflowLive";

const runsLabel = (tones: readonly string[]) => {
  const done = tones.filter((tone) => tone === "plain").length;
  return tones.length === 1 && tones[0] === "faint" ? "Not started" : `${String(tones.length)} ${tones.length === 1 ? "run" : "runs"}, ${String(done)} done`;
};

function item(worker: LiveWorker, selected: string | undefined, known: readonly SessionModel[], onWorker: (key: string) => void): RouteListItem {
  const lines: RouteLine[] = [
    { key: "status", text: worker.status, tone: worker.retry !== undefined ? "warn" : worker.tones.at(-1) === "needs" ? "live" : undefined },
    ...worker.declared ? [{ key: "model", text: worker.model === undefined ? defaultModelLabel(worker.agent) : modelName(worker.model, known) }] : [],
    ...worker.note === undefined ? [] : [{ key: "note", text: worker.note }],
    ...worker.problem === undefined ? [] : [{ key: "problem", text: worker.problem, tone: "bad" as const }],
  ];
  return { key: worker.key, name: worker.name, kind: worker.agent ?? "general helper", tones: worker.tones, blocksLabel: runsLabel(worker.tones), lines,
    selected: selected === worker.key, onPress: () => onWorker(worker.key) };
}

/**
 * Shape: the route of a running workflow. Each stage says where it stands; a worker shows one block per run, where it
 * stands, and its model, and opens its record. The stage at work and a stop that waits list their workers; other
 * stages fold them into blocks until opened. A stage also opens its part of the plan. A run without stages lists the
 * workers the agent started.
 */
export function WorkflowLiveRoute({ stages, prose, selected, known, onStage, onWorker }: {
  stages: readonly LiveStage[];
  /** The workers of a run without stages. */
  prose?: readonly LiveWorker[] | undefined;
  /** The open worker's key. */
  selected?: string | undefined;
  known: readonly SessionModel[];
  onStage: (stage: string) => void;
  onWorker: (key: string) => void;
}) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  if (prose !== undefined) return <RouteList label="Workers" meta={prose.length === 0 ? undefined : String(prose.length)} steps={[{
    key: "workers", name: "This chat follows the plan",
    detail: prose.length === 0 ? "No workers yet. Each one the agent starts shows here." : undefined,
    items: prose.map((worker) => item(worker, selected, known, onWorker)),
  }]} />;
  const done = stages.filter((stage) => stage.progress === "done").length;
  const busy = (live: LiveStage) => live.progress === "current" || live.progress === "waiting";
  return <RouteList label="Route" meta={`${String(done)} of ${String(stages.length)} done`} steps={stages.map((live, index) => {
    const expanded = busy(live) || opened.has(live.stage.id) || live.workers.some((worker) => worker.key === selected);
    const foldable = live.workers.length > 0 && !busy(live);
    return {
      key: live.stage.id, number: index + 1, name: live.stage.name, state: live.progress, detail: live.status, detailTone: live.progress === "waiting" ? "live" : undefined,
      stopTone: live.stopTone, stopLabel: live.stopTone === undefined ? undefined : live.status,
      folded: expanded || live.workers.length === 0 ? undefined : live.workers.flatMap((worker) => worker.tones),
      foldedLabel: expanded ? undefined : runsLabel(live.workers.flatMap((worker) => worker.tones)),
      expanded: foldable ? expanded : undefined,
      onPress: () => {
        if (foldable) setOpened((current) => { const next = new Set(current); if (next.has(live.stage.id)) next.delete(live.stage.id); else next.add(live.stage.id); return next; });
        onStage(live.stage.id);
      },
      items: expanded ? live.workers.map((worker) => item(worker, selected, known, onWorker)) : [],
    };
  })} />;
}
