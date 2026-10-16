import { WorkflowPicker } from "./WorkflowPicker";
import { SAVED } from "./fixtures/runs";
import type { SavedWorkflow } from "./workflowsModel";

export const name = "Workflow picker";
export const note = "The saved workflows a session can start, grouped by folder, each with its route; choosing one opens its plan";

export default function Saved() {
  return <WorkflowPicker saved={SAVED} loading={false} onChoose={() => {}} onClose={() => {}} />;
}
export function WithBroken() {
  return <WorkflowPicker saved={SAVED} broken={[{ name: "old-flow", error: "Invalid workflow stages: Land stage land must be the last stage" }]}
    loading={false} onChoose={() => {}} onClose={() => {}} />;
}
export function Empty() {
  return <WorkflowPicker saved={[]} loading={false} onChoose={() => {}} onClose={() => {}} />;
}

type Stage = [name: string, workers: number, stop?: "approve" | "land"];
const flow = (name: string, folder: string, description: string, stages: Stage[]): SavedWorkflow => ({ name, path: `${folder}/${name}.md`, sha256: name, description,
  definition: { version: 1, stages: stages.map(([stage, workers, stop], index) => ({ id: `s${String(index)}`, name: stage,
    ...(stop ? { stop } : {}), ...(workers > 0 ? { workers: Array.from({ length: workers }, (_, worker) => ({ name: `w${String(worker)}` })) } : {}) })) } });
const PROJECT = "/code/forgerie/.pi/prompts";
const PROFILE = "/home/me/.local/share/forgerie/agent/prompts";
/** The six workflows in the screenshot of 2026-10-16, with their real routes. */
const SIX: SavedWorkflow[] = [
  flow("design-build-review", PROJECT, "Agree a contract, build the interface and the server side in parallel, have two fresh reviewers check both (contract and standards), then land. You approve the contract and the landing.",
    [["Contract", 0, "approve"], ["Design and build", 2], ["Review", 2], ["Land", 0, "land"]]),
  flow("pr-first", PROJECT, "Open a draft PR with the plan first, build on it, mark it ready, and take review from bots, CI and people on the PR. You merge.",
    [["Open the draft PR", 0], ["Build", 2], ["Review on the PR", 2]]),
  flow("nightly-architecture", PROFILE, "Make evidence-backed architectural improvements overnight, report completed work, and wait for approval before rebasing, verifying, and fast-forwarding main",
    [["Establish scope", 1], ["Explore responsibilities", 3], ["Implement and test", 1], ["Independently review", 1], ["Explain completed work", 1], ["Approve landing", 0, "approve"], ["Rebase, verify, and fast-forward", 0]]),
  flow("nightly-maintenance", PROFILE, "Fix failing tests, keep checks fast, and simplify code overnight so the user never wakes up worse off; land only after approval",
    [["Measure bedtime", 2], ["Explore and select", 3], ["Fix, simplify, and test", 1], ["Independently review", 1], ["Write the morning page", 2], ["Approve landing", 0, "approve"], ["Rebase, verify, and fast-forward", 0]]),
  flow("nightly-refine", PROFILE, "Review yesterday's commits and make small architectural refinements for the user to land in the morning",
    [["Survey yesterday", 0], ["Refine", 1], ["Review", 1], ["Land", 0, "land"]]),
  flow("nightly-retro", PROFILE, "Review the last day's sessions for agent struggles and propose environment fixes you pick in the morning",
    [["Collect sessions", 0], ["Find struggles", 4], ["Rank against the repo", 1], ["Pick candidates", 0, "approve"], ["Apply picks", 1], ["Land", 0, "land"]]),
];
export function Six() {
  return <WorkflowPicker saved={SIX} loading={false} onChoose={() => {}} onClose={() => {}} />;
}
