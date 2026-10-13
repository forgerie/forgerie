import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check } from "typebox/value";
import { BacklogAzureDevopsConfigSchema, BacklogConfigSchema, type BacklogConfig } from "@shared/backlog";
import type { BacklogProjectSettings as ProjectSettingsEntry } from "@shared/backlogSettings";
import { azureSourcesOverlap, sourceOverlapMessage, type BacklogSourceInput, type BacklogSourceSettings as SourceSettingsEntry } from "@shared/backlogSources";
import { BacklogSettingsRefusal, type BacklogSettingsApi, type BacklogSettingsCatalog } from "./backlogSettingsApi";
import { BacklogSettingsList } from "./BacklogSettingsList";
import { BacklogProjectSettings } from "./BacklogProjectSettings";
import { BacklogSourceSettings, NO_DESTINATION, type SourceDraft, type SourceProblems } from "./BacklogSourceSettings";
import { readBacklogSettingsPlace } from "./backlogSettingsModel";
type Load = { type: "loading" } | { type: "failed"; message: string } | { type: "ready"; value: BacklogSettingsCatalog };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
/** A project save's 409 is always a newer save. A source's 409 may also be an overlap, and the server's words say which. */
type Refusals = "project" | "source";
export function BacklogSettingsView({ api, selected, onOpen, back, close }: { api: BacklogSettingsApi; selected?: string | undefined; onOpen: (id: string | undefined) => void; back: ReactNode; close: ReactNode }) {
  const [load, setLoad] = useState<Load>({ type: "loading" });
  const [login, setLogin] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { try { const value = await api.list(); setLoad({ type: "ready", value }); setLogin(value.settings.githubLogin ?? ""); } catch (error) { setLoad({ type: "failed", message: message(error) }); } }, [api]);
  useEffect(() => { let active = true; api.list().then((value) => { if (active) { setLoad({ type: "ready", value }); setLogin(value.settings.githubLogin ?? ""); } }, (error: unknown) => { if (active) setLoad({ type: "failed", message: message(error) }); }); return () => { active = false; }; }, [api]);
  // A page change leaves the last page's refusal behind.
  useEffect(() => { setError(undefined); }, [selected]);
  const mutate = async (action: () => Promise<unknown>, refusals: Refusals = "project", then?: () => void) => {
    setBusy(true); setError(undefined);
    try { await action(); await refresh(); then?.(); }
    catch (error) { setError(error instanceof BacklogSettingsRefusal && error.status === 409 && refusals === "project" ? "The backlog settings changed. Reload before saving. Your changes are still here." : message(error)); }
    finally { setBusy(false); }
  };
  const reload = () => { setError(undefined); void refresh(); };
  const place = readBacklogSettingsPlace(selected);
  if (load.type === "ready" && (place.kind === "source" || place.kind === "new-source")) {
    const source = place.kind === "source" ? load.value.settings.sources.find((entry) => entry.id === place.sourceId) : undefined;
    if (place.kind === "new-source" || source) {
      return <SourceEditorBinding key={source ? `${source.id}:${String(source.revision)}` : "new"} source={source} catalog={load.value} back={back} close={close} busy={busy} error={error}
        onReload={reload}
        onSave={(input) => void (source ? mutate(() => api.saveSource(source.id, input, source.revision), "source")
          : mutate(() => api.createSource(input), "source", () => onOpen(undefined)))}
        onDelete={() => { if (source) void mutate(() => api.removeSource(source.id, source.revision), "source", () => onOpen(undefined)); }} />;
    }
  }
  const entry = load.type === "ready" && place.kind === "project" ? load.value.settings.projects.find((p) => p.projectId === place.projectId) : undefined;
  const name = load.type === "ready" && place.kind === "project" ? load.value.projects.find((p) => p.id === place.projectId)?.name : undefined;
  if (entry && !("error" in entry)) return <ProjectEditorBinding key={`${entry.projectId}:${entry.source}:${entry.revision ?? 0}`} entry={entry} name={name ?? entry.projectId} back={back} close={close} busy={busy} error={error}
    onSave={(backlog) => void mutate(() => api.save(entry.projectId, backlog, entry.revision ?? 0))}
    onRemove={() => void mutate(() => api.remove(entry.projectId, entry.revision ?? 0))} onReload={reload} />;
  return <BacklogSettingsList back={back} close={close} load={load} error={error} busy={busy} login={login} onLogin={setLogin}
    onSaveLogin={() => void mutate(() => api.githubLogin(login.trim() || null))} onOpen={onOpen} onReload={() => void refresh()} />;
}

const azure = BacklogAzureDevopsConfigSchema.properties;
/** The draft as the server takes it. Blank optional fields are left out. */
function sourceInput(draft: SourceDraft): BacklogSourceInput {
  const areaPath = draft.areaPath.trim();
  return { organization: draft.organization.trim(), project: draft.project.trim(), ...(areaPath ? { areaPath } : {}),
    ...(draft.destination === NO_DESTINATION ? {} : { destinationProjectId: draft.destination }) };
}

function SourceEditorBinding({ source, catalog, back, close, busy, error, onSave, onDelete, onReload }: {
  source: SourceSettingsEntry | undefined; catalog: BacklogSettingsCatalog; back: ReactNode; close: ReactNode; busy: boolean; error: string | undefined;
  onSave: (input: BacklogSourceInput) => void; onDelete: () => void; onReload: () => void;
}) {
  const [draft, setDraft] = useState<SourceDraft>({ organization: source?.organization ?? "", project: source?.project ?? "", areaPath: source?.areaPath ?? "",
    destination: source?.destinationProjectId ?? NO_DESTINATION });
  const input = sourceInput(draft);
  // A field shows its problem once it holds something; an empty required field only keeps Save off.
  const problems: SourceProblems = {
    ...(input.organization && !Check(azure.organization, input.organization) ? { organization: "Use the organization's name from its address: letters, digits, and hyphens." } : {}),
    ...(input.project && !Check(azure.project, input.project) ? { project: "An Azure project name cannot hold a slash, a backslash, or a control character." } : {}),
    ...(input.areaPath !== undefined && !Check(azure.areaPath, input.areaPath) ? { areaPath: "An Area Path cannot hold a control character." } : {}),
    ...(draft.destination !== NO_DESTINATION && !catalog.projects.some((project) => project.id === draft.destination)
      ? { destination: "This project is no longer registered. Choose another project, or None." } : {}),
  };
  const filled = Boolean(input.organization && input.project);
  // The same rule the server applies at save, so the reason shows before the press.
  const overlapping = filled ? catalog.settings.sources.find((other) => other.id !== source?.id && azureSourcesOverlap(input, other)) : undefined;
  const valid = filled && Object.keys(problems).length === 0 && overlapping === undefined;
  const shown = overlapping ? sourceOverlapMessage(overlapping) : error;
  return <BacklogSourceSettings fresh={source === undefined} title={source?.project ?? "New Azure DevOps source"} back={back} close={close} busy={busy}
    error={shown} recovery={error && !overlapping ? <button onClick={onReload}>Reload</button> : undefined}
    draft={draft} problems={problems} projects={catalog.projects} valid={valid} onDraft={setDraft} onSave={() => onSave(input)} onDelete={onDelete} />;
}

function ProjectEditorBinding({ entry, name, back, close, busy, error, onSave, onRemove, onReload }: {
  entry: ProjectSettingsEntry; name: string; back: ReactNode; close: ReactNode; busy: boolean; error: string | undefined;
  onSave: (backlog: BacklogConfig) => void; onRemove: () => void; onReload: () => void;
}) {
  // Azure DevOps is a source of its own now. A project keeps only the providers it owns.
  const [providers, setProviders] = useState<("markdown" | "github")[]>((entry.backlog.providers ?? ["markdown"]).filter((p): p is "markdown" | "github" => p === "markdown" || p === "github"));
  const [repo, setRepo] = useState(entry.backlog.github?.repo ?? "");
  const [trusted, setTrusted] = useState(entry.backlog.github?.authors !== "all");
  const backlog: BacklogConfig = { ...(entry.backlog.dir === undefined ? {} : { dir: entry.backlog.dir }), providers,
    ...(providers.includes("github") ? { github: { ...(repo.trim() ? { repo: repo.trim() } : {}), authors: trusted ? "trusted" : "all" } } : {}) };
  const valid = providers.length > 0 && Check(BacklogConfigSchema, backlog);
  return <BacklogProjectSettings entry={entry} name={name} back={back} close={close} busy={busy} error={error} valid={valid}
    providers={providers} onSources={(sources) => setProviders(sources.filter((p): p is "markdown" | "github" => p === "markdown" || p === "github"))}
    repo={repo} onRepo={setRepo} trusted={trusted} onTrusted={setTrusted}
    onSave={() => onSave(backlog)} onRemove={onRemove} onReload={onReload} />;
}
