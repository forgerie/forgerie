import { useExternalMessageConverter, type ThreadMessage } from "@assistant-ui/react";
import { convertMessage, type TranscriptMessage } from "./transcript";

/**
 * Converts the transcript for assistant-ui. Adjacent assistant messages of one
 * run join into one reply, so reasoning, tool calls, and text read as a single
 * turn with one set of actions.
 */
export function useThreadMessages(messages: readonly TranscriptMessage[], isRunning: boolean): ThreadMessage[] {
  return useExternalMessageConverter({
    callback: convertMessage,
    // The converter only reads the array. Its signature is not readonly.
    messages: messages as TranscriptMessage[],
    isRunning,
    joinStrategy: "concat-content",
  });
}
