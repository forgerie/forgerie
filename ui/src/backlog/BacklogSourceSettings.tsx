import type { ReactNode } from "react";
import { FolderIcon, Trash2Icon } from "lucide-react";
import { SettingsFrame } from "../ui/settings/SettingsFrame";
import { SettingsField } from "../ui/settings/SettingsField";
import { SettingsInput } from "../ui/settings/SettingsInput";
import { OptionPicker } from "../ui/OptionPicker";
import { HeaderButton } from "../ui/HeaderButton";
import { MenuButton } from "../ui/MenuButton";
import { Lede } from "../ui/Lede";

/** The Destination choice that sends every start to the person: no project is chosen ahead. */
export const NO_DESTINATION = "none";

/** One source being written: what the fields hold, and what is wrong with each. */
export interface SourceDraft {
  organization: string; project: string; areaPath: string;
  /** A registered project's id, or {@link NO_DESTINATION}. A project that left Forgerie keeps its id until the person chooses again. */
  destination: string;
}
export interface SourceProblems { organization?: string | undefined; project?: string | undefined; areaPath?: string | undefined; destination?: string | undefined }

/**
 * Shape: one Azure DevOps board as a backlog source. Its board (organization, Azure project, Area Path) and the
 * project its sessions start in. A board that overlaps another source, and a draft that a newer save replaced,
 * say so in the page's error line. Delete sits in the header's commands, as a group's and a trigger's do, and asks twice.
 */
export function BacklogSourceSettings({ fresh, title, back, close, busy, error, recovery, draft, problems, projects, valid, onDraft, onSave, onDelete }: {
  /** A source that is not saved yet: Save adds it, and there is nothing to delete. */
  fresh: boolean; title: string; back: ReactNode; close: ReactNode; busy: boolean;
  error: string | undefined; recovery?: ReactNode;
  draft: SourceDraft; problems: SourceProblems; projects: readonly { id: string; name: string; path: string }[]; valid: boolean;
  onDraft: (draft: SourceDraft) => void; onSave: () => void; onDelete: () => void;
}) {
  const chosen = projects.find((project) => project.id === draft.destination);
  const destination = draft.destination === NO_DESTINATION ? "None: ask each time" : chosen?.name ?? "Project no longer registered";
  return <SettingsFrame title={title} back={back} error={error} recovery={recovery}
    actions={<><HeaderButton label={busy ? "Saving…" : fresh ? "Add source" : "Save changes"} disabled={busy || !valid} onPress={onSave} />
      {fresh ? null : <MenuButton label="Source commands" commands={[{ label: "Delete source", icon: <Trash2Icon aria-hidden />, tone: "danger", disabled: busy,
        confirm: "Delete? Sessions keep its work items", onSelect: onDelete }]} />}{close}</>}>
    <Lede>{fresh ? "List one Azure DevOps board in the backlog. Each work item shows once, and starts its session in the destination project. Credentials stay in private files on the server."
      : "Each work item on this board shows once in the backlog, and starts its session in the destination project."}</Lede>
    <SettingsField label="Organization" hint="The name in the board's address: dev.azure.com/organization." problem={problems.organization}>
      <SettingsInput label="Organization" value={draft.organization} disabled={busy} onChange={(organization) => onDraft({ ...draft, organization })} /></SettingsField>
    <SettingsField label="Azure project" problem={problems.project}>
      <SettingsInput label="Azure project" value={draft.project} disabled={busy} onChange={(project) => onDraft({ ...draft, project })} /></SettingsField>
    <SettingsField label="Area Path" problem={problems.areaPath}
      hint="Optional. The exact Area Path; work items under it are included. Two sources on one board need Area Paths that do not overlap.">
      <SettingsInput label="Area Path" value={draft.areaPath} disabled={busy} onChange={(areaPath) => onDraft({ ...draft, areaPath })} /></SettingsField>
    <SettingsField label="Destination" problem={problems.destination}
      hint={draft.destination === NO_DESTINATION ? "Each start asks you for a project." : chosen ? "Sessions start in this project. You can choose another one at each start." : undefined}>
      <OptionPicker label="Destination" value={destination} placeholder="Choose a project" search={projects.length > 8 ? "Find a project" : undefined} disabled={busy}
        icon={<FolderIcon aria-hidden size={14} />}
        options={[{ id: NO_DESTINATION, name: "None: ask each time", current: draft.destination === NO_DESTINATION },
          ...projects.map((project) => ({ id: project.id, name: project.name, details: [{ text: project.path, truncate: "start" as const }], current: project.id === draft.destination }))]}
        onChoose={(id) => onDraft({ ...draft, destination: id })} /></SettingsField>
  </SettingsFrame>;
}
