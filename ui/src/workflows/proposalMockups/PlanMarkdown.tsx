// Mockup only. Renders Markdown with the chat's own renderer (MarkdownText),
// so a plan gets every block a reply gets: callouts, steps, status, files,
// facts, details and the rest. The renderer reads its text from an assistant
// message, so this wraps the text in a one-message thread.
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime } from "@assistant-ui/react";
import { MarkdownText } from "../../ui/MarkdownText";
import type { TranscriptMessage } from "../../transcript";
import { useThreadMessages } from "../../useThreadMessages";

const Text = () => <MarkdownText />;
const Assistant = () => <MessagePrimitive.Root className="pm-doc-message">
  <MessagePrimitive.Parts components={{ Text }} />
</MessagePrimitive.Root>;
const components = { AssistantMessage: Assistant, UserMessage: () => null };
const noop = async () => {};

export function PlanMarkdown({ text, id = "plan" }: { text: string; id?: string }) {
  const messages: TranscriptMessage[] = [{ id, role: "assistant", parts: [{ type: "text", text }] }];
  const threadMessages = useThreadMessages(messages, false);
  const runtime = useExternalStoreRuntime({ messages: threadMessages, onNew: noop, isRunning: false });
  return <AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Root className="pm-doc-thread"><ThreadPrimitive.Messages components={components} /></ThreadPrimitive.Root>
  </AssistantRuntimeProvider>;
}
