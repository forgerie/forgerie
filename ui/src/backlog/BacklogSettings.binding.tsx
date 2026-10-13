import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check } from "typebox/value";
import { BacklogConfigSchema, type BacklogConfig } from "@shared/backlog";
import type { BacklogProjectSettings as ProjectSettingsEntry } from "@shared/backlogSettings";
import { BacklogSettingsRefusal, type BacklogSettingsApi, type BacklogSettingsCatalog } from "./backlogSettingsApi";
import { BacklogSettingsList } from "./BacklogSettingsList";
import { BacklogProjectSettings } from "./BacklogProjectSettings";
type Load = { type: "loading" } | { type: "failed"; message: string } | { type: "ready"; value: BacklogSettingsCatalog };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export function BacklogSettingsView({ api, selected, onOpen, back, close }: { api: BacklogSettingsApi; selected?: string | undefined; onOpen: (id: string | undefined) => void; back: ReactNode; close: ReactNode }) {
  const [load, setLoad] = useState<Load>({ type: "loading" });
  const [login, setLogin] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { try { const value = await api.list(); setLoad({ type: "ready", value }); setLogin(value.settings.githubLogin ?? ""); } catch (error) { setLoad({ type: "failed", message: message(error) }); } }, [api]);
  useEffect(() => { let active = true; api.list().then((value) => { if (active) { setLoad({ type: "ready", value }); setLogin(value.settings.githubLogin ?? ""); } }, (error: unknown) => { if (active) setLoad({ type: "failed", message: message(error) }); }); return () => { active = false; }; }, [api]);
  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(undefined);
    try { await action(); await refresh(); }
    catch (error) { setError(error instanceof BacklogSettingsRefusal && error.status === 409 ? "The backlog settings changed. Reload before saving. Your changes are still here." : message(error)); }
    finally { setBusy(false); }
  };
  const entry = load.type === "ready" ? load.value.settings.projects.find((p) => p.projectId === selected) : undefined;
  const name = load.type === "ready" ? load.value.projects.find((p) => p.id === selected)?.name ?? selected : selected;
  if (entry) return <ProjectEditorBinding key={`${entry.projectId}:${entry.source}:${entry.revision ?? 0}`} entry={entry} name={name ?? entry.projectId} back={back} close={close} busy={busy} error={error}
    onSave={(backlog) => void mutate(() => api.save(entry.projectId, backlog, entry.revision ?? 0))}
    onRemove={() => void mutate(() => api.remove(entry.projectId, entry.revision ?? 0))} onReload={() => { setError(undefined); void refresh(); }} />;
  return <BacklogSettingsList back={back} close={close} load={load} error={error} busy={busy} login={login} onLogin={setLogin}
    onSaveLogin={() => void mutate(() => api.githubLogin(login.trim() || null))} onOpen={onOpen} onReload={() => void refresh()} />;
}

function ProjectEditorBinding({ entry, name, back, close, busy, error, onSave, onRemove, onReload }: {
  entry: ProjectSettingsEntry; name: string; back: ReactNode; close: ReactNode; busy: boolean; error: string | undefined;
  onSave: (backlog: BacklogConfig) => void; onRemove: () => void; onReload: () => void;
}) {
  const [providers, setProviders] = useState<NonNullable<BacklogConfig["providers"]>>(entry.backlog.providers ?? ["markdown"]);
  const [org, setOrg] = useState(entry.backlog.azureDevops?.organization ?? "");
  const [project, setProject] = useState(entry.backlog.azureDevops?.project ?? "");
  const [area, setArea] = useState(entry.backlog.azureDevops?.areaPath ?? "");
  const [repo, setRepo] = useState(entry.backlog.github?.repo ?? "");
  const [trusted, setTrusted] = useState(entry.backlog.github?.authors !== "all");
  const backlog: BacklogConfig = { ...(entry.backlog.dir === undefined ? {} : { dir: entry.backlog.dir }), providers,
    ...(providers.includes("github") ? { github: { ...(repo.trim() ? { repo: repo.trim() } : {}), authors: trusted ? "trusted" : "all" } } : {}),
    ...(providers.includes("azure-devops") ? { azureDevops: { organization: org.trim(), project: project.trim(), ...(area.trim() ? { areaPath: area.trim() } : {}) } } : {}) };
  const valid = providers.length > 0 && Check(BacklogConfigSchema, backlog);
  return <BacklogProjectSettings entry={entry} name={name} back={back} close={close} busy={busy} error={error} valid={valid}
    providers={providers} onSources={(sources) => setProviders(sources.filter((p): p is "markdown" | "github" | "azure-devops" => p === "markdown" || p === "github" || p === "azure-devops"))}
    org={org} onOrg={setOrg} project={project} onProject={setProject} area={area} onArea={setArea} repo={repo} onRepo={setRepo} trusted={trusted} onTrusted={setTrusted}
    onSave={() => onSave(backlog)} onRemove={onRemove} onReload={onReload} />;
}
