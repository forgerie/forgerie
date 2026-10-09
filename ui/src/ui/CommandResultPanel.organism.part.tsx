import { useState } from "react";
import type { CommandResult } from "../commands";
import { CommandResultPanel } from "./CommandResultPanel";

export const name = "Command feedback";
export const note = "Short confirmations are transient. Detailed output and choices stay until dismissed.";
export const composition = {
  default: [{ part: "src/ui/Toast.molecule.part.tsx", state: "MessageOnly" }],
  LongName: [{ part: "src/ui/Toast.molecule.part.tsx", state: "LongText" }],
};

function Example({ initial }: { initial: CommandResult }) {
  const [result, setResult] = useState<CommandResult | undefined>(initial);
  return <div><p>The document stays in place while command feedback appears.</p>
    {result ? <CommandResultPanel result={result} disabled={false} onClose={() => setResult(undefined)}
      onChoose={(_requestId, value) => setResult({ type: "done", presentation: "toast", message: `Selected ${value}` })} /> : <p>Dismissed.</p>}
  </div>;
}
export default function Renamed() { return <Example initial={{ type: "done", presentation: "toast", message: "Session named: skill editing" }} />; }
export function LongName() { return <Example initial={{ type: "done", presentation: "toast", message: `Session named: ${"very-long-session-name-".repeat(8)}` }} />; }
export function Details() { return <Example initial={{ type: "done", message: "Session: s1\nMessages: 2\nTool calls: 3\nTokens: ↑10 ↓5 total 15\nCost: $0.1235" }} />; }
export function Choices() { return <Example initial={{ type: "select", requestId: "fork-1", title: "Fork from message", options: [{ value: "first", label: "First question" }, { value: "latest", label: "Latest question" }] }} />; }
