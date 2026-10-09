import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChoiceSelect } from "../ui/ChoiceSelect";
import { ProjectGroups } from "./ProjectGroups";
import { RetainedWorkspaces } from "./RetainedWorkspaces.binding";
import type { ProjectGroupApi, GroupCatalog } from "./projectGroupApi";

/** The chosen group survives a reload, a fold and a rotation, as the list's other arrangement does. */
const SELECTED_KEY = "forgerie.projectGroup";
const readSelected = () => { try { return window.localStorage.getItem(SELECTED_KEY) ?? ""; } catch { return ""; } };
const writeSelected = (id: string) => { try { if (id) window.localStorage.setItem(SELECTED_KEY, id); else window.localStorage.removeItem(SELECTED_KEY); } catch { /* The choice stays for this page only. */ } };
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/**
 * The group catalog, shared by the filter over the session list and by
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
  const mutate = useCallback(async (run: () => Promise<unknown>) => {
    setPending(true); setError(undefined);
    try { await run(); await refresh(); }
    catch (cause) { setError(message(cause)); throw cause; }
    finally { setPending(false); }
  }, [refresh]);
  return useMemo(() => ({ catalog, loaded, selected: group ? selected : "", setSelected, scope, pending, error, refresh, mutate }),
    [catalog, loaded, group, selected, setSelected, scope, pending, error, refresh, mutate]);
}
export type ProjectGroupState = ReturnType<typeof useProjectGroups>;

/** The filter over the session list. Manage opens Settings → Project groups. */
export function GroupFilter({ state, onManage }: { state: ProjectGroupState; onManage: () => void }) {
  return <>
    <ChoiceSelect label="Group" value={state.selected}
      options={[{ value: "", label: "All projects" }, ...state.catalog.groups.map((group) => ({ value: group.id, label: group.name }))]}
      onChoose={state.setSelected} action={{ label: "Manage", onPress: onManage }} />
    {state.error && !state.pending && <p role="status">Project groups unavailable. All projects remain accessible.</p>}
  </>;
}

/** Settings → Project groups. */
export function ProjectGroupSettings({ api, state, back, close }: { api: ProjectGroupApi; state: ProjectGroupState; back: ReactNode; close: ReactNode }) {
  const { catalog, mutate, refresh } = state;
  useEffect(() => { void refresh(); }, [refresh]);
  return <ProjectGroups back={back} actions={close} catalog={catalog} pending={state.pending} error={state.error}
    onRegister={(path) => mutate(() => api.register(path))} onRefresh={() => { void refresh(); }}
    onSave={(id, name, ids, revision) => mutate(() => {
      const group = catalog.groups.find((item) => item.id === id);
      if (id !== undefined && group === undefined) throw new Error("The group was removed. Reload before saving.");
      return api.save(name, ids, group ? { ...group, revision: revision ?? group.revision } : undefined);
    })}
    onRemove={(id, revision) => mutate(() => { const group = catalog.groups.find((item) => item.id === id); if (!group) throw new Error("Group is no longer available."); return api.remove({ ...group, revision: revision ?? group.revision }); })}>
    <RetainedWorkspaces api={api} />
  </ProjectGroups>;
}
