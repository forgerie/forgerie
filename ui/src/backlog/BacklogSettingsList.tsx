import type { ReactNode } from "react";
import type { BacklogSettingsCatalog } from "./backlogSettingsApi";
import { SettingsFrame } from "../ui/settings/SettingsFrame";
import { SettingsField } from "../ui/settings/SettingsField";
import { SettingsRow } from "../ui/settings/SettingsRow";
import { SettingsInput } from "../ui/settings/SettingsInput";
import { Lede } from "../ui/Lede";
import { ListSection } from "../ui/ListSection";
import { ActionFooter } from "../ui/ActionFooter";
import { backlogSettingsOrigin } from "./backlogSettingsModel";
export function BacklogSettingsList({ back, close, load, error, busy, login, onLogin, onSaveLogin, onOpen, onReload }: {
  back: ReactNode; close: ReactNode; load: { type: "loading" } | { type: "failed"; message: string } | { type: "ready"; value: BacklogSettingsCatalog };
  error: string | undefined; busy: boolean; login: string; onLogin: (login: string) => void; onSaveLogin: () => void; onOpen: (id: string) => void; onReload: () => void;
}) {
  return <SettingsFrame title="Backlog" back={back} actions={close} error={error ?? (load.type === "failed" ? load.message : undefined)} recovery={<button onClick={onReload}>Reload</button>}>
    {load.type === "loading" ? <Lede>Reading backlog settings…</Lede> : load.type === "ready" ? <>
      <SettingsField label="GitHub username" hint="Mine shows issues assigned to this username. This is not a credential."><SettingsInput label="GitHub username" value={login} onChange={onLogin} disabled={busy} /></SettingsField>
      <ActionFooter actions={[{ label: "Save username", disabled: busy || login === (load.value.settings.githubLogin ?? ""), onPress: onSaveLogin }]} />
      <Lede>Choose each project's backlog sources. Credentials stay in private files on the server.</Lede>
      <ListSection title="Projects" empty="Register a project to configure its backlog.">{load.value.settings.projects.map((entry) => <SettingsRow key={entry.projectId}
        name={load.value.projects.find((p) => p.id === entry.projectId)?.name ?? entry.projectId} description={backlogSettingsOrigin(entry.source)} onOpen={() => onOpen(entry.projectId)} />)}</ListSection>
    </> : null}
  </SettingsFrame>;
}
