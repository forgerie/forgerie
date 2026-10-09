import type { ReactNode } from "react";
import { DialogPanel } from "../ui/DialogPanel";
import { ActionCard } from "../ui/ActionCard";
import { ActionButton } from "../ui/ActionButton";
import { AlertCard } from "../ui/AlertCard";
import type { ProjectContext } from "./projectGroupApi";
import type { WorktreeInfo } from "../worktrees/worktreeApi";
export type RelatedAction = "changes" | "pulls" | "land" | "discard" | "path";
export function RelatedRepos({ context, error, busy, preparing, onPrepare, onAction, onRefresh, onClose, children }: {
  context?: ProjectContext | undefined; error?: string | undefined; busy: boolean; preparing?: string | undefined;
  onPrepare: (id: string) => void; onAction: (action: RelatedAction, info: WorktreeInfo) => void;
  onRefresh: () => void; onClose: () => void; children?: ReactNode;
}) {
  return <DialogPanel title="Related repositories" onClose={onClose}>
    <p>This chat stays in its starting project. Prepare another repo to work there with the same agent.</p>
    {error && <p role="alert">{error}</p>}
    {!context && !error && <p role="status">Reading projects…</p>}
    {context && context.groups.length === 0 && <p>Add related projects to a group in Settings → Project groups.</p>}
    {context?.projects.filter((project) => project.id !== context.home?.id).map((project) => <ActionCard key={project.id} title={project.name} detail={project.path}
      actions={[{ label: preparing === project.id ? "Preparing…" : "Prepare worktree", disabled: preparing !== undefined || busy, onPress: () => onPrepare(project.id) }]} />)}
    {context?.related.map((info) => <ActionCard key={info.id} title={`${context.projects.find((project) => project.id === info.relatedSession?.projectId)?.name ?? info.repo.split("/").at(-1)} · ${info.branch}`} detail={info.path}
      actions={[
        { label: "Changes and files", disabled: info.state.kind !== "active", onPress: () => onAction("changes", info) },
        { label: "Pull requests", disabled: info.state.kind !== "active", onPress: () => onAction("pulls", info) },
        { label: info.state.kind === "landed" ? "Retry cleanup" : `Land on ${info.defaultBranch}`, disabled: busy || info.setup.phase !== "done" || info.state.kind === "discarded" || info.cleanup.kind === "done", onPress: () => onAction("land", info) },
        { label: info.state.kind === "discarded" ? "Retry discard cleanup" : "Discard", disabled: busy || info.state.kind === "landed" || info.cleanup.kind === "done", onPress: () => onAction("discard", info) },
        { label: "Add path to chat", onPress: () => onAction("path", info) },
        ...(info.setup.phase === "failed" && info.relatedSession ? [{ label: "Retry setup", disabled: busy || preparing !== undefined, onPress: () => onPrepare(info.relatedSession!.projectId) }] : []),
      ]}>
      <p>{info.state.kind === "active" ? `${info.setup.phase}${info.dirtyFiles === undefined ? "" : ` · ${info.dirtyFiles} changed files`}` : info.state.kind}</p>
      {info.setup.error && <AlertCard label="Setup failed" title={info.branch} codeLabel="Hook" code="worktree-post-create" output={info.setup.log} outputLabel="Setup log">{info.setup.error}</AlertCard>}
      {info.cleanup.kind === "failed" && <p role="alert">Cleanup: {info.cleanup.error}</p>}
      {info.statusError && <p role="alert">{info.statusError}</p>}
    </ActionCard>)}
    {children}<ActionButton label="Refresh related work" onPress={onRefresh} />
  </DialogPanel>;
}
