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

/** The providers a project owns. Azure DevOps boards are sources of their own, set up in the Sources list. */
const PROJECT_PROVIDERS = [{ id: "markdown", label: "Markdown" }, { id: "github", label: "GitHub" }] as const;

/**
 * Shape: one project's backlog. A project lists its Markdown files and its GitHub issues. A repo file that still
 * has an Azure DevOps section says so above the fields, because Forgerie no longer reads it.
 */
export function BacklogProjectSettings({ entry, name, back, close, busy, error, valid, providers, onSources, repo, onRepo, trusted, onTrusted, onSave, onRemove, onReload }: {
  entry: ProjectSettingsEntry; name: string; back: ReactNode; close: ReactNode; busy: boolean; error: string | undefined; valid: boolean;
  providers: string[]; onSources: (sources: string[]) => void; repo: string; onRepo: (value: string) => void; trusted: boolean; onTrusted: (value: boolean) => void;
  onSave: () => void; onRemove: () => void; onReload: () => void;
}) {
  return <SettingsFrame title={name} back={back} actions={<><HeaderButton label={busy ? "Saving…" : "Save changes"} disabled={busy || !valid} onPress={onSave} />{close}</>} error={error}
    recovery={error ? <button onClick={onReload}>Reload</button> : undefined}
    notice={entry.warnings?.length ? entry.warnings.map((warning) => <p key={warning}>{warning}</p>) : undefined}>
    <Lede>{backlogSettingsOrigin(entry.source)}</Lede>
    <ChoiceList legend="Providers" missing="Unknown provider" search="Find a provider" choices={PROJECT_PROVIDERS} chosen={providers} disabled={busy} onChange={onSources} />
    {providers.includes("github") ? <>
      <SettingsField label="GitHub repo" hint="Optional owner/name override. Otherwise use the origin remote."><SettingsInput label="GitHub repo" value={repo} onChange={onRepo} disabled={busy} /></SettingsField>
      <SettingsField label="Trusted authors only" hint={trusted ? "List repo owners, members, and collaborators." : "List all authors. Their text is untrusted agent context."}><SettingsToggle label="Trusted authors only" checked={trusted} onChange={onTrusted} disabled={busy} /></SettingsField>
    </> : null}
    {!valid ? <Lede>Select at least one provider and fill in its valid settings.</Lede> : null}
    <ActionFooter actions={[{ label: "Use the repo file", onPress: onRemove, disabled: busy || entry.source !== "forgerie" }]} note="Forgerie replaces the whole repo backlog section. Turning Markdown off leaves its files on disk. Add Azure DevOps boards under Sources in Settings → Backlog." />
  </SettingsFrame>;
}
