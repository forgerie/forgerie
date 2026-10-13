import type { ReactNode } from "react";
import { PlusIcon } from "lucide-react";
import type { BacklogSettingsCatalog } from "./backlogSettingsApi";
import { SettingsFrame } from "../ui/settings/SettingsFrame";
import { SettingsField } from "../ui/settings/SettingsField";
import { SettingsRow } from "../ui/settings/SettingsRow";
import { SettingsInput } from "../ui/settings/SettingsInput";
import { Lede } from "../ui/Lede";
import { ListSection } from "../ui/ListSection";
import { ActionFooter } from "../ui/ActionFooter";
import { HeaderButton } from "../ui/HeaderButton";
import { backlogSettingsOrigin, sourceBoard, sourceDestinationText, sourceSelection } from "./backlogSettingsModel";

/**
 * Shape: Settings → Backlog. Sources come first: an Azure DevOps board is a backlog of its own, owned by no project,
 * with a destination where its sessions start. Projects follow, with their Markdown files and GitHub issues.
 */
export function BacklogSettingsList({ back, close, load, error, busy, login, onLogin, onSaveLogin, onOpen, onReload }: {
  back: ReactNode; close: ReactNode; load: { type: "loading" } | { type: "failed"; message: string } | { type: "ready"; value: BacklogSettingsCatalog };
  error: string | undefined; busy: boolean; login: string; onLogin: (login: string) => void; onSaveLogin: () => void; onOpen: (id: string) => void; onReload: () => void;
}) {
  // Adding a source is the page's one main action, so it sits in the header, where scrolling cannot take it away.
  return <SettingsFrame title="Backlog" back={back} actions={<>
    <HeaderButton label="Add Azure DevOps source" icon={<PlusIcon aria-hidden size={16} />} disabled={busy || load.type !== "ready"} onPress={() => onOpen(sourceSelection(undefined))} />
    {close}
  </>} error={error ?? (load.type === "failed" ? load.message : undefined)} recovery={<button onClick={onReload}>Reload</button>}>
    {load.type === "loading" ? <Lede>Reading backlog settings…</Lede> : load.type === "ready" ? <>
      <SettingsField label="GitHub username" hint="Mine shows issues assigned to this username. This is not a credential."><SettingsInput label="GitHub username" value={login} onChange={onLogin} disabled={busy} /></SettingsField>
      <ActionFooter actions={[{ label: "Save username", disabled: busy || login === (load.value.settings.githubLogin ?? ""), onPress: onSaveLogin }]} />
      <Lede>An Azure DevOps board is a source of its own: each work item shows once, and its session starts in the source's destination. Markdown files and GitHub issues belong to their project. Credentials stay in private files on the server.</Lede>
      <ListSection title="Sources" empty="No Azure DevOps boards yet. Use Add Azure DevOps source to list one.">
        {load.value.settings.sources.map((source) => <SettingsRow key={source.id} name={source.project} meta={sourceBoard(source)}
          description={sourceDestinationText(source, load.value.projects)}
          flags={source.warnings.length ? source.warnings.map((warning) => <span key={warning} data-tone="error">{warning}</span>) : undefined}
          onOpen={() => onOpen(sourceSelection(source.id))} />)}
      </ListSection>
      <ListSection title="Projects" empty="Register a project to configure its backlog.">{load.value.settings.projects.map((entry) => <SettingsRow key={entry.projectId}
        name={load.value.projects.find((p) => p.id === entry.projectId)?.name ?? entry.projectId} description={"error" in entry ? undefined : backlogSettingsOrigin(entry.source)}
        flags={"error" in entry ? <span data-tone="error">{entry.error}</span> : entry.warnings?.length ? <span>The repo file's Azure DevOps section is no longer read</span> : undefined} dimmed={"error" in entry}
        onOpen={() => { if (!("error" in entry)) onOpen(entry.projectId); }} />)}</ListSection>
    </> : null}
  </SettingsFrame>;
}
