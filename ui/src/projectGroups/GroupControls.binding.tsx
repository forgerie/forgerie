import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { SettingsFrame } from "../ui/settings/SettingsFrame";
import { Lede } from "../ui/Lede";
import { WorktreeDialog, type WorktreeCommand } from "../ui/WorktreeActions";
import type { PickerFilter } from "../ui/Picker";
import type { WorktreeInfo } from "../worktrees/worktreeApi";
import { ProjectGroups } from "./ProjectGroups";
import { GroupEditor, type GroupDraft } from "./GroupEditor";
import { isMissingFolder, type ProjectGroupApi, type GroupCatalog } from "./projectGroupApi";
import type { Project } from "../newSession";

/** The chosen group survives a reload, a fold and a rotation, as the list's other arrangement does. */
const SELECTED_KEY = "forgerie.projectGroup";
const readSelected = () => { try { return window.localStorage.getItem(SELECTED_KEY) ?? ""; } catch { return ""; } };
const writeSelected = (id: string) => { try { if (id) window.localStorage.setItem(SELECTED_KEY, id); else window.localStorage.removeItem(SELECTED_KEY); } catch { /* The choice stays for this page only. */ } };
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/**
 * The group catalog, shared by the session list's filter and by
 * Settings → Project groups. A group that no longer exists shows all projects.
 */
export function useProjectGroups(api: ProjectGroupApi) {
  const [catalog, setCatalog] = useState<GroupCatalog>({ groups: [], projects: [] });
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelectedState] = useState(readSelected);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    try { setCatalog(await api.list()); setLoaded(true); setError(undefined); }
    catch (cause) { setError(message(cause)); }
  }, [api]);
  useEffect(() => { void refresh(); const read = () => { void refresh(); }; window.addEventListener("focus", read); return () => window.removeEventListener("focus", read); }, [refresh]);
  const setSelected = useCallback((id: string) => { setSelectedState(id); writeSelected(id); }, []);
  const group = catalog.groups.find((item) => item.id === selected);
  // Until the catalog loads, or when it cannot, the list shows every project.
  const scope = loaded && error === undefined ? group?.projectIds : undefined;
  const mutate = useCallback(async <T,>(run: () => Promise<T>): Promise<T> => {
    setPending(true); setError(undefined);
    try { const result = await run(); await refresh(); return result; }
    catch (cause) { setError(message(cause)); throw cause; }
    finally { setPending(false); }
  }, [refresh]);
  // The session list's filter: the groups in its ⋯ menu, and the chosen one above the list.
  const filter = useMemo<Omit<PickerFilter, "onManage">>(() => ({
    value: scope ? selected : "", onChoose: setSelected,
    options: catalog.groups.map((item) => ({ value: item.id, label: item.name, detail: plural(item.projectIds.length, "project") })),
  }), [catalog.groups, scope, selected, setSelected]);
  return useMemo(() => ({ catalog, loaded, selected: group ? selected : "", setSelected, scope, filter, pending, error, refresh, mutate }),
    [catalog, loaded, group, selected, setSelected, scope, filter, pending, error, refresh, mutate]);
}
export type ProjectGroupState = ReturnType<typeof useProjectGroups>;

/** Worktrees that chats made in a second repo, including those of archived chats. */
function useRelatedWorktrees(api: ProjectGroupApi) {
  const [items, setItems] = useState<WorktreeInfo[]>([]);
  const [error, setError] = useState<string>();
  const read = useCallback(async () => {
    try { setItems((await api.allWorkspaces()).related); setError(undefined); }
    catch (cause) { setError(`Could not read related worktrees: ${message(cause)}`); }
  }, [api]);
  useEffect(() => { void read(); }, [read]);
  return { items, error, read };
}

type Draft = GroupDraft & { revision?: number | undefined; base: GroupDraft };
// Drafts outlive this page, as agent drafts do, so Back and a fold keep them. They hold no secrets.
const drafts = new Map<string, Draft>();
const same = (left: GroupDraft, right: GroupDraft) => left.name === right.name
  && left.projectIds.length === right.projectIds.length && left.projectIds.every((id) => right.projectIds.includes(id));

/**
 * Settings → Project groups. `group` is the open group's id, `"new"` for a
 * group that is not saved yet, or undefined for the list.
 */
export function ProjectGroupSettings({ api, state, group, onOpen, back, close }: {
  api: ProjectGroupApi; state: ProjectGroupState; group: string | undefined; onOpen: (group: string | undefined) => void;
  back: ReactNode; close: ReactNode;
}) {
  const { catalog, loaded, pending, error, mutate, refresh } = state;
  const worktrees = useRelatedWorktrees(api);
  const [command, setCommand] = useState<{ info: WorktreeInfo; command: WorktreeCommand }>();
  const [, redraw] = useState(0);
  useEffect(() => { void refresh(); }, [refresh]);

  if (group === undefined) return <>
    <ProjectGroups back={back} close={close} catalog={catalog} loaded={loaded} error={error}
      worktrees={worktrees.items} worktreeError={worktrees.error}
      onNew={() => onOpen("new")} onOpen={onOpen} onRefresh={() => { void refresh(); void worktrees.read(); }}
      onWorktree={(info, next) => setCommand({ info, command: next })} />
    {command ? <WorktreeDialog command={command.command} info={command.info} api={api.worktrees}
      onDone={() => { void worktrees.read(); }} onClose={() => setCommand(undefined)} /> : null}
  </>;

  const fresh = group === "new";
  const saved = catalog.groups.find((item) => item.id === group);
  if (!fresh && !saved) return <SettingsFrame back={back} title="Project group" actions={close} error={error}>
    <Lede>{loaded ? "This group no longer exists. Someone may have deleted it from another window. Go back to Project groups." : "Reading groups…"}</Lede>
  </SettingsFrame>;

  const base: GroupDraft = saved ? { name: saved.name, projectIds: [...saved.projectIds] } : { name: "", projectIds: [] };
  const stored = drafts.get(group);
  const draft: Draft = stored ?? { ...base, revision: saved?.revision, base };
  const dirty = fresh ? draft.name.trim() !== "" || draft.projectIds.length > 0 : !same(draft, draft.base);
  const change = (next: GroupDraft) => {
    const value = { ...draft, ...next };
    if (!fresh && same(value, value.base)) drafts.delete(group); else drafts.set(group, value);
    redraw((count) => count + 1);
  };
  const forget = () => { drafts.delete(group); redraw((count) => count + 1); };
  const include = (project: Project) => {
    const current = drafts.get(group) ?? draft;
    if (!current.projectIds.includes(project.id)) change({ name: current.name, projectIds: [...current.projectIds, project.id] });
  };
  return <GroupEditor back={back} close={close} fresh={fresh} draft={draft} projects={catalog.projects} dirty={dirty} pending={pending} error={error}
    onChange={change} onDiscard={forget}
    onSave={() => {
      // The draft keeps the revision it started from, so a save never overwrites a change made elsewhere.
      void mutate(() => api.save(draft.name.trim(), draft.projectIds, saved ? { ...saved, revision: draft.revision ?? saved.revision } : undefined))
        .then(() => { forget(); if (fresh) onOpen(undefined); }).catch(() => undefined);
    }}
    onDelete={saved ? () => {
      void mutate(() => api.remove({ ...saved, revision: draft.revision ?? saved.revision }))
        .then(() => { forget(); onOpen(undefined); }).catch(() => undefined);
    } : undefined}
    onRegister={(path) => mutate(() => api.register(path).catch((cause: unknown) => {
      // A missing folder is a question for the reader, not a page error.
      if (isMissingFolder(cause)) return undefined;
      throw cause;
    })).then((project) => project ? include(project) : {
      message: `No folder at ${path}. Create it and add it as a project?`,
      action: "Create folder",
      run: () => mutate(() => api.register(path, true)).then(include),
    })} />;
}
