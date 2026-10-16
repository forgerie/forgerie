import type { ManagedProcessInfo } from "@shared/apiTypes";
import { ProcessesPanel } from "./ProcessesPanel";
import type { ProcessesState } from "./processesStore";

export const name = "Managed processes";
export const note = "Session-owned commands: attached and lost labels, output with stderr tinted, stdin, and Stop";
const NOW = 1_792_000_000_000;
const minutes = (count: number) => NOW - count * 60_000;
const base: ManagedProcessInfo = { id: "", name: "", pid: 0, command: "", cwd: "/workspace", startTime: minutes(14), endTime: null, status: "running", exitCode: null,
  success: null, endReason: null, signal: null, errorMessage: null, lastLogLine: null, supervision: "systemd" };
const ready = (processes: ManagedProcessInfo[]): ProcessesState => ({ view: { kind: "ready", snapshot: { available: true, writeSupported: true, processes } } });
const state = ready([
  { ...base, id: "attached", name: "Preview watcher", command: "npm run dev", supervision: "attached", notice: "Attached process: ends when Forgerie restarts.", lastLogLine: { text: "Ready at http://localhost:5173/", truncatedStart: false } },
  { ...base, id: "lost", name: "Build", command: "npm run build", status: "exited", success: false, endReason: "lost", errorMessage: "supervisor lost", endTime: minutes(60), lastLogLine: { text: "Build stopped before completion", truncatedStart: true } },
]);
const MIXED = ready([
  { ...base, id: "vite", name: "vite-dev", pid: 48211, command: "npm run dev -- --host 127.0.0.1 --port 8504" },
  { ...base, id: "tests", name: "vitest-watch", pid: 48302, command: "npx vitest --watch ui/src/decisions", startTime: minutes(41) },
  { ...base, id: "types", name: "typecheck", pid: 48390, command: "npm run typecheck", status: "exited", exitCode: 2, success: false, endReason: "exit", startTime: minutes(4), endTime: minutes(3) },
  { ...base, id: "api", name: "api-server", command: "node --enable-source-maps dist/server.js --config /home/simonwjackson/code/sandbox/forgerie/.worktree/sheet-redesign/forgerie.config.json",
    status: "exited", endReason: "lost", errorMessage: "Forgerie restarted and could not reattach. The process may still run outside Forgerie.", startTime: minutes(90), endTime: minutes(60) },
  { ...base, id: "book", name: "storybook", pid: 47001, command: "npm run storybook -- --no-open", status: "killed", endReason: "signal", startTime: minutes(150), endTime: minutes(120) },
]);
const LOG = ["> forgerie-ui@0.42.0 dev", "> vite --host 127.0.0.1 --port 8504", "", "  VITE v6.3.5  ready in 412 ms", "", "  ➜  Local:   http://127.0.0.1:8504/",
  "(!) Could not auto-determine entry point from rollupOptions or html files. Skipping dependency pre-bundling.",
  "12:14:02 [vite] hmr update /src/ui/SheetDialog.tsx, /src/ui/SheetDialog.css", "12:18:11 [vite] Internal server error: Transform failed with 1 error:",
  "/src/decisions/DecisionsSheet.tsx:88:4: ERROR: Unexpected \"}\"", "12:18:29 [vite] hmr update /src/decisions/DecisionsSheet.tsx"].join("\n");
const actions = { onSelect: () => {}, onStop: () => {}, onWrite: async () => ({ ok: true as const }), onRefresh: () => {}, onClose: () => {}, onAsk: () => {}, now: () => NOW };
export default function List() { return <ProcessesPanel state={state} {...actions} />; }
export function Mixed() { return <ProcessesPanel state={MIXED} {...actions} />; }
export function Empty() { return <ProcessesPanel state={ready([])} {...actions} />; }
export function Running() { return <ProcessesPanel state={{ ...MIXED, selected: "vite", output: LOG, stderr: [6, 8, 9] }} {...actions} />; }
export function Attached() { return <ProcessesPanel state={{ ...state, selected: "attached", output: "Ready at http://localhost:5173/\nWatching source files" }} {...actions} />; }
export function Lost() { return <ProcessesPanel state={{ ...state, selected: "lost", output: "Building…" }} {...actions} />; }
export function LongOutput() {
  if (state.view.kind !== "ready") throw new Error("Expected ready process fixture");
  const processes = state.view.snapshot.processes.map(process => ({ ...process, lastLogLine: { text: "unbroken".repeat(512), truncatedStart: true } }));
  return <ProcessesPanel state={{ view: { kind: "ready", snapshot: { ...state.view.snapshot, processes } } }} {...actions} />;
}
