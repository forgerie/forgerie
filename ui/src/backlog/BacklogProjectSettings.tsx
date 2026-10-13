import type { ReactNode } from "react";
import type { BacklogProjectSettings as ProjectSettingsEntry } from "@shared/backlogSettings";
import { SettingsFrame } from "../ui/settings/SettingsFrame";
import { SettingsField } from "../ui/settings/SettingsField";
import { SettingsToggle } from "../ui/settings/SettingsToggle";
import { SettingsInput } from "../ui/settings/SettingsInput";
import { ChoiceList } from "../ui/ChoiceList";
import { HeaderButton } from "../ui/HeaderButton";
import { ActionFooter } from "../ui/ActionFooter";
import { Lede } from "../ui/Lede";
import { backlogSettingsOrigin } from "./backlogSettingsModel";
export function BacklogProjectSettings({ entry, name, back, close, busy, error, valid, providers, onSources, org, onOrg, project, onProject, area, onArea, repo, onRepo, trusted, onTrusted, onSave, onRemove, onReload }: {
  entry: ProjectSettingsEntry; name: string; back: ReactNode; close: ReactNode; busy: boolean; error: string | undefined; valid: boolean;
  providers: string[]; onSources: (sources: string[]) => void; org: string; onOrg: (value: string) => void; project: string; onProject: (value: string) => void;
  area: string; onArea: (value: string) => void; repo: string; onRepo: (value: string) => void; trusted: boolean; onTrusted: (value: boolean) => void;
  onSave: () => void; onRemove: () => void; onReload: () => void;
}) {
  return <SettingsFrame title={name} back={back} actions={<><HeaderButton label={busy ? "Saving…" : "Save changes"} disabled={busy || !valid} onPress={onSave} />{close}</>} error={error} recovery={error ? <button onClick={onReload}>Reload</button> : undefined}>
    <Lede>{backlogSettingsOrigin(entry.source)}</Lede>
    <ChoiceList legend="Sources" missing="Unknown source" search="Find a source" choices={[{ id: "markdown", label: "Markdown" }, { id: "github", label: "GitHub" }, { id: "azure-devops", label: "Azure DevOps" }]} chosen={providers} disabled={busy} onChange={onSources} />
    {providers.includes("azure-devops") ? <>
      <SettingsField label="Organization"><SettingsInput label="Organization" value={org} onChange={onOrg} disabled={busy} /></SettingsField>
      <SettingsField label="Azure project"><SettingsInput label="Azure project" value={project} onChange={onProject} disabled={busy} /></SettingsField>
      <SettingsField label="Area Path" hint="Use the exact Azure Area Path and non-overlapping areas when repositories share a project. Descendants are included."><SettingsInput label="Area Path" value={area} onChange={onArea} disabled={busy} /></SettingsField>
    </> : null}
    {providers.includes("github") ? <>
      <SettingsField label="GitHub repo" hint="Optional owner/name override. Otherwise use the origin remote."><SettingsInput label="GitHub repo" value={repo} onChange={onRepo} disabled={busy} /></SettingsField>
      <SettingsField label="Trusted authors only" hint={trusted ? "List repo owners, members, and collaborators." : "List all authors. Their text is untrusted agent context."}><SettingsToggle label="Trusted authors only" checked={trusted} onChange={onTrusted} disabled={busy} /></SettingsField>
    </> : null}
    {!valid ? <Lede>Select at least one source and fill in its valid settings.</Lede> : null}
    <ActionFooter actions={[{ label: "Use the repo file", onPress: onRemove, disabled: busy || entry.source !== "forgerie" }]} note="Forgerie replaces the whole repo backlog section. Turning Markdown off leaves its files on disk." />
  </SettingsFrame>;
}
