// A fixed assistant-ui runtime for parts that show the input bar: the production Thread and Composer read it as they
// read a session's. Nothing here reaches the network; a send only clears the draft.
import { useEffect, type ReactNode } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";

const same = (message: ThreadMessageLike) => message;

/** Holds `messages` as the thread, `running` as a turn in progress, and `draft` in the input once it mounts. */
export function FixtureRuntime({ messages = [], running = false, draft, children }: {
  messages?: readonly ThreadMessageLike[]; running?: boolean; draft?: string | undefined; children: ReactNode;
}) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({ messages, isRunning: running, convertMessage: same,
    onNew: async () => undefined, onCancel: async () => undefined });
  useEffect(() => { if (draft !== undefined) runtime.thread.composer.setText(draft); }, [runtime, draft]);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

