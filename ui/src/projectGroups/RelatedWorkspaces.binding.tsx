import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActionButton } from "../ui/ActionButton";
import { ActionCard } from "../ui/ActionCard";
import { ChangesReview } from "../ui/ChangesReview";
import { WorktreeDialog, type WorktreeCommand } from "../ui/WorktreeActions";
import { createWorktreeApi, type WorktreeInfo } from "../worktrees/worktreeApi";
import { createChangesSource } from "../changes/changesSource";
import { createFilesSource } from "../changes/filesSource";
import { createNoteTray } from "../changes/noteTray";
import { browserStorage, createDraftStore } from "../draftStore";
import { newStartupToken, type Fetch } from "../newSession";
import type { PullLink } from "../pullRequests/pullRequestApi";
import { RelatedPulls } from "./RelatedPulls.binding";
import { RelatedRepos, type RelatedAction } from "./RelatedRepos";
import type { ProjectContext, ProjectGroupApi } from "./projectGroupApi";

type Panel = { kind: "changes"; info: WorktreeInfo } | { kind: "pulls"; info: WorktreeInfo } | { kind: "command"; info: WorktreeInfo; command: WorktreeCommand };
export function RelatedWorkspaces({ api, request, source, busy, links, onAsk }: {
  api: ProjectGroupApi; request: Fetch; source: { id: string; cwd: string }; busy: boolean; links: readonly PullLink[]; onAsk: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<ProjectContext>();
  const [error, setError] = useState<string>();
  const [preparing, setPreparing] = useState<string>();
  const [panel, setPanel] = useState<Panel>();
  const ids = useRef(new Map<string, string>());
  const ref = useMemo(() => ({ id: source.id, cwd: source.cwd }), [source.id, source.cwd]);
  const worktrees = useMemo(() => createWorktreeApi(request), [request]);
  const refresh = useCallback(async () => {
    try { setContext(await api.context(ref)); setError(undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [api, ref]);
  useEffect(() => { if (!busy || open) void refresh(); }, [busy, open, refresh]);
  const prepare = async (projectId: string) => {
    setPreparing(projectId); setError(undefined);
    const token = ids.current.get(projectId) ?? newStartupToken(); ids.current.set(projectId, token);
    try { await api.prepare(ref, projectId, token); ids.current.delete(projectId); await refresh(); }
    catch (cause) { await refresh(); setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPreparing(undefined); }
  };
  const [drafts] = useState(() => createDraftStore(browserStorage()));
  const [notesFor, setNotesFor] = useState<WorktreeInfo>();
  const tray = useMemo(() => createNoteTray(notesFor ? drafts.session(`${ref.id}:related:${notesFor.id}`) : undefined), [drafts, ref.id, notesFor]);
  const notes = useSyncExternalStore(tray.subscribe, tray.notes);
  const changes = useMemo(() => panel?.kind === "changes" ? { source: createChangesSource(panel.info.path, request), files: createFilesSource(panel.info.path, request) } : undefined, [panel, request]);
  const active = context?.related.filter((item) => item.state.kind === "active") ?? [];
  const action = (kind: RelatedAction, info: WorktreeInfo) => {
    if (kind === "changes") { setNotesFor(info); setPanel({ kind, info }); }
    else if (kind === "pulls") setPanel({ kind, info });
    else if (kind === "land" || kind === "discard") setPanel({ kind: "command", info, command: kind });
    else { onAsk(`Use the related worktree ${info.id} at ${info.path}. Read its repository instructions before changes. Keep this chat's starting directory unchanged.`); setOpen(false); }
  };
  return <>
    <ActionButton label={active.length ? `Related repos (${active.length})` : "Related repos"} onPress={() => setOpen(true)} />
    {open && !panel && <RelatedRepos context={context} error={error} busy={busy} preparing={preparing} onPrepare={(id) => { void prepare(id); }} onAction={action} onRefresh={() => { void refresh(); }} onClose={() => setOpen(false)}>
      {notesFor && notes.length > 0 && <ActionCard title={`${notes.length} review notes`} detail={notesFor.path} actions={[{ label: "Add notes to chat draft", onPress: () => {
        onAsk(`Review notes for related checkout ${notesFor.path}:\n${notes.map((note) => `\nFile: ${notesFor.path}/${note.path}\n${note.comment}\nSelected diff lines:\n${note.lines.map((line) => `${line.kind} ${"newLineNumber" in line ? line.newLineNumber : line.oldLineNumber}: ${line.text}`).join("\n")}`).join("\n")}`);
        tray.drop(notes.map((note) => note.id)); setOpen(false);
      } }]} />}
    </RelatedRepos>}
    {panel?.kind === "changes" && changes && <ChangesReview source={changes.source} files={changes.files} notes={notes} onAdd={tray.add} onEdit={tray.edit} onRemove={tray.remove} onClose={() => setPanel(undefined)} />}
    {panel?.kind === "pulls" && <RelatedPulls request={request} target={{ id: ref.id, cwd: panel.info.path }} links={links} onClose={() => setPanel(undefined)} onAsk={onAsk} />}
    {panel?.kind === "command" && <WorktreeDialog command={panel.command} info={panel.info} api={worktrees} onClose={() => setPanel(undefined)}
      onDone={() => { void refresh(); }} onAsk={async (text) => { onAsk(`In related checkout ${panel.info.path}:\n${text}`); setPanel(undefined); setOpen(false); }} />}
  </>;
}
