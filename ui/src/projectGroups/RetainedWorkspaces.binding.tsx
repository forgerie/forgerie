import { useCallback, useEffect, useState } from "react";
import { ActionButton } from "../ui/ActionButton";
import { ActionCard } from "../ui/ActionCard";
import { WorktreeDialog, type WorktreeCommand } from "../ui/WorktreeActions";
import type { WorktreeInfo } from "../worktrees/worktreeApi";
import type { ProjectGroupApi } from "./projectGroupApi";
/** Recovery is independent of whether the owner chat remains in the picker. The list sits on the settings page itself. */
export function RetainedWorkspaces({ api }: { api: ProjectGroupApi }) {
  const [items, setItems] = useState<WorktreeInfo[]>();
  const [error, setError] = useState<string>();
  const [command, setCommand] = useState<{ info: WorktreeInfo; command: WorktreeCommand }>();
  const read = useCallback(async () => {
    try { setItems((await api.allWorkspaces()).related); setError(undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [api]);
  useEffect(() => { void read(); }, [read]);
  return <section aria-labelledby="related-worktrees">
    <h2 id="related-worktrees">Related worktrees</h2>
    <p>Worktrees stay here when their chat is archived or deleted. Removing a group does not remove its work.</p>
    {error && <p role="alert">{error}</p>}
    {items === undefined && !error && <p role="status">Reading related worktrees…</p>}
    {items?.length === 0 && !error && <p>No related worktrees.</p>}
    {items?.map((info) => <ActionCard key={info.id} title={`${info.repo.split("/").at(-1)} · ${info.branch}`} detail={`${info.path} · chat ${info.relatedSession?.id}`}
      actions={info.cleanup.kind === "done" ? [] : [
        { label: info.state.kind === "landed" ? "Retry cleanup" : `Land on ${info.defaultBranch}`, disabled: info.state.kind === "discarded" || info.setup.phase !== "done", onPress: () => setCommand({ info, command: "land" }) },
        { label: "Discard", disabled: info.state.kind === "landed", onPress: () => setCommand({ info, command: "discard" }) },
      ]}><p>{info.state.kind}</p>{info.cleanup.kind === "failed" && <p role="alert">{info.cleanup.error}</p>}</ActionCard>)}
    <ActionButton label="Refresh related worktrees" onPress={() => { void read(); }} />
    {command && <WorktreeDialog command={command.command} info={command.info} api={api.worktrees} onDone={() => { void read(); }} onClose={() => setCommand(undefined)} />}
  </section>;
}
