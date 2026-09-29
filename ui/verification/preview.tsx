// Separate dev-only entry point. This preview has no transport or network data.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import { convertMessage, type TextMessage } from "../src/transcript";
import { Thread } from "../src/ui/Thread";
import { SessionFrame } from "../src/ui/SessionFrame";
import "../src/ui/theme.css";

const initialMessages: TextMessage[] = [
  { id: "question", role: "user", text: "Show the smallest session client." },
  { id: "answer", role: "assistant", status: { type: "complete", reason: "stop" }, text:
    "## Keep the Pi connection\n\nThe existing store handles **history and streaming**. Bind the new view to the same runtime.\n\n```ts\nconst runtime = useExternalStoreRuntime({\n  messages, convertMessage, onNew,\n});\n```\n\n| Part | Responsibility |\n| --- | --- |\n| Store | Pi connection |\n| Thread | Messages and composer |\n\nNo backend changes are needed."
  },
];
const scenario = new URLSearchParams(location.search).get("scenario") ?? "history";
const stressMessages: TextMessage[] = [initialMessages[0]!, { ...initialMessages[1]!, text:
  `## Long content\n\nhttps://example.test/${"long-segment/".repeat(30)}\n\n\`\`\`ts\nconst path = '${"directory/".repeat(40)}';\n\`\`\`\n\n| One | Two | Three | Four | Five | Six |\n| --- | --- | --- | --- | --- | --- |\n| Value | Value | Value | Value | Value | Value |`
}];
function Preview() {
  const [messages, setMessages] = useState<TextMessage[]>(scenario === "empty" || scenario === "loading" ? [] : scenario === "stress" ? stressMessages : initialMessages);
  const [running, setRunning] = useState(scenario === "running");
  async function onNew(message: AppendMessage) {
    const text = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    setMessages((current) => [...current, { id: `user-${current.length}`, role: "user", text },
      { id: `reply-${current.length}`, role: "assistant", text: "This is a local preview. No prompt was sent to Pi.", status: { type: "complete", reason: "stop" } }]);
  }
  const runtime = useExternalStoreRuntime({ messages, convertMessage, onNew, onCancel: async () => setRunning(false),
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
