import { useMemo, useState } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessage } from "@assistant-ui/react";
import type { LaunchDraft } from "../NewSession";
import type { Launch } from "../launches";
import { SessionFrame } from "../ui/SessionFrame";
import { StatusChip } from "../ui/StatusChip";
import { Thread } from "../ui/Thread";
import { WorktreeDialog } from "../ui/WorktreeActions";
import { mergeRecord, type WorktreeApi } from "../worktrees/worktreeApi";
import { WorktreeSetupCard } from "../ui/WorktreeSetupCard";

export interface PendingSessionRecovery {
  onDiscarded?: (() => void) | undefined;
  onRestore: () => void;
  onRetrySetup: () => void;
  worktrees: Pick<WorktreeApi, "land" | "discardPreview" | "discard">;
}

/** A launch is not a server session. Its prompt can render without opening a session transport. */
export function PendingSession({ launch, recovery }: { launch: Launch<LaunchDraft>; recovery?: PendingSessionRecovery | undefined }) {
  const [discarding, setDiscarding] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const messages = useMemo<ThreadMessage[]>(() => [{ id: launch.id, role: "user", createdAt: new Date(launch.startedAt),
    content: [{ type: "text", text: launch.draft.text }], attachments: [...launch.draft.attachments], metadata: { custom: {} } }], [launch.id, launch.startedAt, launch.draft]);
  const runtime = useExternalStoreRuntime({ messages, onNew: async () => {}, isRunning: false, isDisabled: true });
  const failed = launch.state.type === "failed";
  const progress = launch.state.type === "starting" ? launch.state.progress ?? "Starting…" : launch.state.type === "failed" ? launch.state.error : "Opening…";
  const actions = failed && recovery ? <div className="wt-setup-actions">
    <button type="button" className="wt-secondary" onClick={recovery.onRestore}>Restore draft</button>
    {launch.worktree?.setup.phase === "failed" && !discarded && <>
      {(launch.prompt.text !== "" || launch.placement.item || launch.prompt.files?.length || launch.prompt.images?.length) &&
        <button type="button" className="primary wt-primary" onClick={recovery.onRetrySetup}>Retry setup</button>}
      <button type="button" className="wt-secondary" onClick={() => setDiscarding(true)}>Discard worktree…</button>
    </>}
  </div> : undefined;
  return <SessionFrame name={launch.title} status={<StatusChip label={failed ? "Start failed" : "Starting…"} tone={failed ? "bad" : "neutral"} />}>
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread readOnly={<><p className={failed ? "ns-error" : "ns-status"} role={failed ? "alert" : "status"}>{progress}</p>{actions}</>}
        head={launch.worktree ? <WorktreeSetupCard setup={launch.worktree.setup} hookSeen={launch.hookSeen === true} branch={launch.worktree.branch} /> : undefined} />
    </AssistantRuntimeProvider>
    {discarded && <p className="ns-status" role="status">Worktree discarded. Restore the draft to start again.</p>}
    {discarding && launch.worktree && recovery && <WorktreeDialog command="discard" info={mergeRecord(undefined, launch.worktree)} api={recovery.worktrees}
      onDone={(result) => { if (result.kind === "discarded") { setDiscarded(true); recovery.onDiscarded?.(); } }} onClose={() => setDiscarding(false)} />}
  </SessionFrame>;
}
