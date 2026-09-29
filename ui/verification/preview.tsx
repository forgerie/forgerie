// Separate dev-only entry point. This preview has no transport or network data.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import type { ToolState, TranscriptMessage, TranscriptPart } from "../src/transcript";
import { useThreadMessages } from "../src/useThreadMessages";
import { Thread } from "../src/ui/Thread";
import { SessionFrame } from "../src/ui/SessionFrame";
import "../src/ui/theme.css";

const say = (id: string, role: TranscriptMessage["role"], text: string): TranscriptMessage => ({ id, role, parts: [{ type: "text", text }] });
const tool = (id: string, name: string, args: unknown, state: ToolState): TranscriptPart => ({ type: "tool", id, name, args, state });
const done = (output: string, isError = false): ToolState => ({ type: "done", output, isError });

const initialMessages: TranscriptMessage[] = [
  say("question", "user", "Show the smallest session client."),
  say("answer", "assistant",
    "## Keep the Pi connection\n\nThe existing store handles **history and streaming**. Bind the new view to the same runtime.\n\n```ts\nconst runtime = useExternalStoreRuntime({\n  messages, convertMessage, onNew,\n});\n```\n\n| Part | Responsibility |\n| --- | --- |\n| Store | Pi connection |\n| Thread | Messages and composer |\n\nNo backend changes are needed."),
];
const stressMessages: TranscriptMessage[] = [initialMessages[0]!, say("answer", "assistant",
  `## Long content\n\nhttps://example.test/${"long-segment/".repeat(30)}\n\n\`\`\`ts\nconst path = '${"directory/".repeat(40)}';\n\`\`\`\n\n| One | Two | Three | Four | Five | Six |\n| --- | --- | --- | --- | --- | --- |\n| Value | Value | Value | Value | Value | Value |`)];
const testOutput = Array.from({ length: 40 }, (_, index) => ` ✓ src/transcript.test.ts > case ${index + 1} (${index % 7 + 1} ms)`).join("\n");
// A coding turn: reasoning, a group of reads, a failed command, an edit, and the answer.
const toolMessages = (running: boolean): TranscriptMessage[] => [
  say("q", "user", "Why does the reply show a stuck tool row?"),
  { id: "a1", role: "assistant", parts: [
    { type: "thinking", text: "The **tool.start** event may arrive before `message.end`. Check how the transcript matches call ids." },
    { type: "text", text: "I'll read the reducer and its tests first." },
    tool("r1", "read", { path: "src/transcript.ts" }, done("export function reduceEvent(state, event) {\n  switch (event.type) {\n    // …\n  }\n}")),
    tool("r2", "read", { path: "src/transcript.test.ts" }, done("describe(\"tool executions\", () => { … })")),
    tool("g1", "bash", { command: `grep -rn "toolCallId" src --include=*.ts | head -40 # ${"very-long-argument ".repeat(6)}` }, done("src/transcript.ts:12: toolCallId")),
  ] },
  { id: "a2", role: "assistant", parts: [
    tool("f1", "bash", { command: "npm test -- transcript" }, done("Error: expected 1 execution, received 2\n    at transcript.test.ts:88:5", true)),
    { type: "text", text: "The test confirms two executions for one call. I'll match on the call id in both directions." },
    tool("e1", "edit", { path: "src/transcript.ts", edits: [{ oldText: "a", newText: "b" }] }, done("Successfully replaced 1 block(s) in src/transcript.ts.")),
  ] },
  { id: "a3", role: "assistant", parts: running
    ? [tool("t1", "bash", { command: "npm test" }, { type: "running", output: testOutput })]
    : [tool("t1", "bash", { command: "npm test" }, done(testOutput)),
      { type: "text", text: "Fixed. `tool.start` now advances the execution that `message.end` created, so each call shows **one** line." }] },
];

const scenario = new URLSearchParams(location.search).get("scenario") ?? "history";
const scenarios: Record<string, TranscriptMessage[]> = {
  empty: [], loading: [], stress: stressMessages, tools: toolMessages(false), "tools-running": toolMessages(true),
};
function Preview() {
  const [messages, setMessages] = useState<TranscriptMessage[]>(scenarios[scenario] ?? initialMessages);
  const [running, setRunning] = useState(scenario === "running" || scenario === "tools-running");
  async function onNew(message: AppendMessage) {
    const text = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    setMessages((current) => [...current, say(`user-${current.length}`, "user", text),
      say(`reply-${current.length}`, "assistant", "This is a local preview. No prompt was sent to Pi.")]);
  }
  const threadMessages = useThreadMessages(messages, running);
  const runtime = useExternalStoreRuntime({ messages: threadMessages, onNew, onCancel: async () => setRunning(false),
    isRunning: running, isLoading: scenario === "loading", isDisabled: scenario === "loading" || scenario === "disconnected" });
  return <AssistantRuntimeProvider runtime={runtime}>
    <SessionFrame name="Session client" status={scenario === "loading" ? "Connecting" : scenario === "disconnected" ? "Disconnected" : running ? "Running" : "Connected"}
      error={scenario === "disconnected" ? "Connection lost. Reload to reconnect." : undefined}
      recovery={scenario === "disconnected" ? <button onClick={() => location.reload()}>Reload</button> : undefined}>
      <Thread />
    </SessionFrame>
  </AssistantRuntimeProvider>;
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root");
createRoot(root).render(<Preview />);
