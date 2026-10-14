import { ProcessesPanel } from "./ProcessesPanel";
import type { ProcessesState } from "./processesStore";

export const name = "Managed processes";
export const note = "Session-owned commands: attached and lost labels, output, stdin, and Stop";
const state: ProcessesState = { view: { kind: "ready", snapshot: { available: true, writeSupported: true, processes: [
  { id: "attached", name: "Preview watcher", pid: 0, command: "npm run dev", cwd: "/workspace", startTime: 1, endTime: null, status: "running", exitCode: null,
    success: null, endReason: null, signal: null, errorMessage: null, supervision: "attached", notice: "Attached process: ends when Forgerie restarts." },
  { id: "lost", name: "Build", pid: 0, command: "npm run build", cwd: "/workspace", startTime: 1, endTime: null, status: "exited", exitCode: null,
    success: false, endReason: "lost", signal: null, errorMessage: "supervisor lost", supervision: "systemd" },
] } } };
const actions = { onSelect: () => {}, onStop: () => {}, onWrite: async () => ({ ok: true as const }), onRefresh: () => {}, onClose: () => {} };
export default function List() { return <ProcessesPanel state={state} {...actions} />; }
export function Attached() { return <ProcessesPanel state={{ ...state, selected: "attached", output: "Ready at http://localhost:5173/\nWatching source files" }} {...actions} />; }
export function Lost() { return <ProcessesPanel state={{ ...state, selected: "lost", output: "Building…" }} {...actions} />; }
