import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChangesReview } from "../ui/ChangesReview";
import { markdownView } from "../markdown/markdownView";
import type { MarkdownView } from "../ui/useMarkdownView";
import { SessionMenu, WorktreeDialog, type SessionMenuSection, type WorktreeCommand } from "../ui/WorktreeActions";
import { createWorktreeApi, type WorktreeInfo } from "../worktrees/worktreeApi";
import { createChangesSource } from "../changes/changesSource";
import { createFilesSource } from "../changes/filesSource";
import { createNoteTray } from "../changes/noteTray";
import { browserStorage, createDraftStore } from "../draftStore";
import { newStartupToken, type Fetch } from "../newSession";
import type { PullLink } from "../pullRequests/pullRequestApi";
import { RelatedPulls } from "./RelatedPulls.binding";
import { relatedSections, type RelatedAction } from "./relatedSections";
import type { OwnWorktree } from "./relatedWork";
import type { ProjectGroupApi } from "./projectGroupApi";

type Panel = { kind: "changes"; info: WorktreeInfo } | { kind: "pulls"; info: WorktreeInfo } | { kind: "command"; info: WorktreeInfo; command: WorktreeCommand };
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/**
 * The chat's header menu: its own worktree, then the worktrees it made in
 * other repos. The agent prepares those with its project tools; this reads
 * them again after each run, so a new one appears when the run that made it
 * ends. Nothing is added to the input bar.
 */
export function RelatedWorkspaces({ api, request, source, busy, links, onAsk, own, commands }: {
  api: ProjectGroupApi; request: Fetch; source: { id: string; cwd: string }; busy: boolean; links: readonly PullLink[]; onAsk: (text: string) => void;
  own?: OwnWorktree | undefined;
  commands?: SessionMenuSection["commands"] | undefined;
}) {
  const [related, setRelated] = useState<WorktreeInfo[]>([]);
  const [panel, setPanel] = useState<Panel>();
  // Rich or Source for Markdown in the review, remembered on this device for every Markdown file.
  const [reviewView, setReviewView] = useState<MarkdownView>(() => markdownView.read());
  const chooseReviewView = useCallback((view: MarkdownView) => { markdownView.write(view); setReviewView(view); }, []);
  const [retrying, setRetrying] = useState(false);
  const [failures, setFailures] = useState<Record<string, string>>({});
  // Note counts are read from the trays on each draw; this redraws after notes leave a tray.
  const [, redraw] = useState(0);
  const ref = useMemo(() => ({ id: source.id, cwd: source.cwd }), [source.id, source.cwd]);
  const worktrees = useMemo(() => createWorktreeApi(request), [request]);
  const refresh = useCallback(async () => {
    // A failed read keeps the chips already drawn; the next run's end reads again.
    try { setRelated((await api.context(ref)).related); } catch { /* Keep the last known chips. */ }
  }, [api, ref]);
  useEffect(() => { if (!busy) void refresh(); }, [busy, refresh]);

  // Review notes wait per worktree, saved with this chat's drafts, until they go into a message.
  const [drafts] = useState(() => createDraftStore(browserStorage()));
  const [trays] = useState(() => new Map<string, ReturnType<typeof createNoteTray>>());
  const trayOf = useCallback((info: WorktreeInfo) => {
    let tray = trays.get(info.id);
    if (!tray) { tray = createNoteTray(drafts.session(`${ref.id}:related:${info.id}`)); trays.set(info.id, tray); }
    return tray;
  }, [trays, drafts, ref.id]);
  const reviewTray = panel?.kind === "changes" ? trayOf(panel.info) : undefined;
  const noop = useMemo(() => createNoteTray(undefined), []);
  const shown = reviewTray ?? noop;
  const reviewNotes = useSyncExternalStore(shown.subscribe, shown.notes);
  const counts = Object.fromEntries(related.map((info) => [info.id, trays.get(info.id)?.notes().length ?? 0]));
  const changes = useMemo(() => panel?.kind === "changes" ? { source: createChangesSource(panel.info.path, request), files: createFilesSource(panel.info.path, request) } : undefined, [panel, request]);

  const act = (action: RelatedAction, info: WorktreeInfo) => {
    if (action === "changes" || action === "pulls") setPanel({ kind: action, info });
    else if (action === "land" || action === "discard") setPanel({ kind: "command", info, command: action });
    else if (action === "explain") onAsk(`Setting up the related worktree at ${info.path} failed${info.setup.error ? `: ${info.setup.error}` : "."}\nSetup log:\n${info.setup.log || "(empty)"}\nFind the cause, fix it if you can, then retry setup with project_worktree.`);
    else if (action === "notes") {
      const tray = trayOf(info);
      const notes = tray.notes();
      onAsk(`Review notes for related checkout ${info.path}:\n${notes.map((note) => `\nFile: ${info.path}/${note.path}\n${note.comment}\nSelected diff lines:\n${note.lines.map((line) => `${line.kind} ${"newLineNumber" in line ? line.newLineNumber : line.oldLineNumber}: ${line.text}`).join("\n")}`).join("\n")}`);
      tray.drop(notes.map((note) => note.id));
      redraw((count) => count + 1);
    } else if (action === "retry" && info.relatedSession && !retrying) {
      setRetrying(true);
      setFailures((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== info.id)));
      api.prepare(ref, info.relatedSession.projectId, newStartupToken())
        .catch((cause: unknown) => setFailures((current) => ({ ...current, [info.id]: `Retry failed: ${message(cause)}` })))
        .finally(() => { setRetrying(false); void refresh(); });
    }
  };
  return <>
    <SessionMenu info={own?.info} onCommand={own?.onCommand} busy={busy} commands={commands}
      sections={relatedSections(related, { busy: busy || retrying, notes: counts, failures, onAction: act })} />
    {panel?.kind === "changes" && changes && reviewTray && <ChangesReview source={changes.source} files={changes.files} notes={reviewNotes}
      onAdd={reviewTray.add} onEdit={reviewTray.edit} onRemove={reviewTray.remove} onClose={() => setPanel(undefined)}
      markdownView={reviewView} onMarkdownView={chooseReviewView} />}
    {panel?.kind === "pulls" && <RelatedPulls request={request} target={{ id: ref.id, cwd: panel.info.path }} links={links} onClose={() => setPanel(undefined)} onAsk={onAsk} />}
    {panel?.kind === "command" && <WorktreeDialog command={panel.command} info={panel.info} api={worktrees} onClose={() => setPanel(undefined)}
      onDone={() => { void refresh(); }} onAsk={async (text) => { onAsk(`In related checkout ${panel.info.path}:\n${text}`); setPanel(undefined); }} />}
  </>;
}
