import { RouteMap } from "./RouteMap";

export const name = "Route map";
export const note = "Steps on one rail; the reader's steps are rings, and each step's workers are tracks";

export default function Planned() {
  return <RouteMap label="What happens" steps={[
    { key: "a", name: "Contract", state: "next", mine: true, does: "This chat writes the contract. You approve it." },
    { key: "b", name: "Design and build", state: "next", does: "Two workers, each on its own branch.", tracks: [
      { key: "design", name: "design", state: "next", lines: ["design-engineer", "claude-opus-5.5"] },
      { key: "build", name: "build", state: "next", lines: ["full-stack-engineer"] },
    ] },
    { key: "c", name: "Land", state: "next", mine: true, does: "You land the branches on main." },
  ]} />;
}
export function Working() {
  return <RouteMap label="Run" steps={[
    { key: "a", name: "Contract", state: "done", mine: true, word: "Approved by you" },
    { key: "b", name: "Design and build", state: "working", tracks: [
      { key: "design", name: "design", state: "working", lines: ["design-engineer", "design/run-export"], label: "Open design", onPress: () => {} },
      { key: "build", name: "build", state: "done", lines: ["full-stack-engineer", "feat/run-export-api"], label: "Open build", onPress: () => {} },
    ] },
    { key: "c", name: "Land", state: "next", mine: true },
  ]} />;
}
export function Waiting() {
  return <RouteMap label="Run" steps={[
    { key: "a", name: "Contract", state: "waiting", mine: true, does: "This chat writes the contract. You approve it." },
    { key: "b", name: "Design and build", state: "next" },
  ]} />;
}
/** A worker that waits to retry a model error, beside one whose report was a duplicate. */
export function Retrying() {
  return <RouteMap label="Run" steps={[
    { key: "a", name: "Contract", state: "done", mine: true, word: "Approved by you" },
    { key: "b", name: "Design and build", state: "working", tracks: [
      { key: "design", name: "design", state: "working", lines: ["design-engineer", "design/run-export"],
        notice: ["Retrying 2 of 3: 529 overloaded_error: Overloaded", "Next try in 1 min 40 s"], label: "Open design", onPress: () => {} },
      { key: "build", name: "build", state: "done", lines: ["full-stack-engineer", "feat/run-export-api", "Duplicate report, not sent again"], label: "Open build", onPress: () => {} },
    ] },
    { key: "c", name: "Land", state: "next", mine: true },
  ]} />;
}
