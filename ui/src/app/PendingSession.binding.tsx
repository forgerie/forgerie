import { useMemo } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessage } from "@assistant-ui/react";
import type { LaunchDraft } from "../NewSession";
import type { Launch } from "../launches";
import { SessionFrame } from "../ui/SessionFrame";
import { StatusChip } from "../ui/StatusChip";
import { Thread } from "../ui/Thread";
import { WorktreeSetupCard } from "../ui/WorktreeSetupCard";

/** A launch is not a server session. Its prompt can render without opening a session transport. */
export function PendingSession({ launch }: { launch: Launch<LaunchDraft> }) {
  const messages = useMemo<ThreadMessage[]>(() => [{ id: launch.id, role: "user", createdAt: new Date(launch.startedAt),
    content: [{ type: "text", text: launch.draft.text }], attachments: [...launch.draft.attachments], metadata: { custom: {} } }], [launch.id, launch.startedAt, launch.draft]);
  const runtime = useExternalStoreRuntime({ messages, onNew: async () => {}, isRunning: false, isDisabled: true });
  const failed = launch.state.type === "failed";
  const progress = launch.state.type === "starting" ? launch.state.progress ?? "Starting…" : launch.state.type === "failed" ? launch.state.error : "Opening…";
  return <SessionFrame name={launch.title} status={<StatusChip label={failed ? "Start failed" : "Starting…"} tone={failed ? "bad" : "neutral"} />}>
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread readOnly={<p className={failed ? "ns-error" : "ns-status"} role={failed ? "alert" : "status"}>{progress}</p>}
        head={launch.worktree ? <WorktreeSetupCard setup={launch.worktree.setup} hookSeen={launch.hookSeen === true} branch={launch.worktree.branch} /> : undefined} />
    </AssistantRuntimeProvider>
  </SessionFrame>;
}
