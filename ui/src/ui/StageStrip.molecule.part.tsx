import { WorkflowIcon } from "lucide-react";
import { StageStrip, type StageStripSegment, type StageStripState } from "./StageStrip";

export const name = "Stage strip";
export const note = "A whole process as one row above an input: a block grid with a column per stage and a block per worker, then the name and status";

const stage = (key: string, ...lanes: StageStripState[]): StageStripSegment => ({ key, lanes });

export default function Waiting() {
  return <StageStrip icon={<WorkflowIcon />} title="Design, build, review" status="Contract, waiting for you" count={1} label="Open the run"
    segments={[stage("research", "done", "done"), stage("contract", "waiting"), stage("build", "next", "next"), stage("review", "next"), stage("land", "next")]} onPress={() => {}} />;
}
export function Working() {
  return <StageStrip icon={<WorkflowIcon />} title="Design, build, review" status="Build, 2 working" label="Open the run"
    segments={[stage("research", "done", "done"), stage("contract", "done"), stage("build", "working", "working", "done"), stage("review", "next"), stage("land", "next")]}
    onPress={() => {}} />;
}
export function Failed() {
  return <StageStrip icon={<WorkflowIcon />} title="Design, build, review" status="Failed" label="Open the run"
    segments={[stage("research", "done", "done"), stage("contract", "done"), stage("build", "failed", "done"), stage("review", "next"), stage("land", "next")]} onPress={() => {}} />;
}
export function Finished() {
  return <StageStrip icon={<WorkflowIcon />} title="Design, build, review" status="Finished" label="Open the run"
    segments={[stage("research", "done", "done"), stage("contract", "done"), stage("build", "done", "done", "done"), stage("review", "done"), stage("land", "done")]}
    onPress={() => {}} />;
}
/** A review per module: more stages than the grid's share holds, so the leading ones fold into a count. One of them failed, so the count is red. */
export function ManyStages() {
  const modules = ["auth", "billing", "cache", "cli", "config", "db", "events", "export", "feeds", "files", "flags", "forms", "graph", "hooks", "i18n", "import",
    "jobs", "keys", "logs", "mail", "maps", "media", "metrics", "notify", "orders", "pay", "perms", "queue", "rates", "search", "shop", "sync", "tags",
    "teams", "theme", "tokens", "uploads", "users", "views", "webhooks"];
  const segments = modules.map((module, index) => stage(module, ...(index === 2 ? ["failed", "done"] as const : index < 34 ? ["done"] as const
    : index < 36 ? ["working", "working", "working", "working"] as const : ["next"] as const)));
  return <StageStrip icon={<WorkflowIcon />} title="Review every module" status="Teams and theme, 4 working" label="Open the run" segments={segments} onPress={() => {}} />;
}
/** A prose-only workflow: no stages, so the icon stands where the grid would be. */
export function NoStages() {
  return <StageStrip icon={<WorkflowIcon />} title="Tidy the changelog" status="Running" label="Open the run" segments={[]} onPress={() => {}} />;
}
