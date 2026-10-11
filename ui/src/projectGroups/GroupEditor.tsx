import { useId, type ReactNode } from "react";
import { Trash2Icon, XIcon } from "lucide-react";
import { SettingsFrame } from "../ui/settings/SettingsFrame";
import { HeaderButton } from "../ui/HeaderButton";
import { MenuButton, type MenuCommand } from "../ui/MenuButton";
import { TitleField } from "../ui/TitleField";
import { ChoiceList } from "../ui/ChoiceList";
import { TextSubmit, type TextSubmitFollowUp } from "../ui/TextSubmit";
import type { Project } from "../newSession";

export interface GroupDraft { name: string; projectIds: string[] }

/**
 * One project group as a document, like an agent or a plugin: its name is the
 * title, its projects the body. The header saves; rare commands wait in ⋯.
 * Changes stay a draft until Save, and a refused save keeps the draft.
 */
export function GroupEditor({ back, close, fresh, draft, projects, dirty, pending, error, onChange, onSave, onDiscard, onDelete, onRegister }: {
  back?: ReactNode; close?: ReactNode;
  /** A group that is not saved yet. */
  fresh: boolean;
  draft: GroupDraft; projects: readonly Project[];
  dirty: boolean; pending: boolean; error?: string | undefined;
  onChange: (draft: GroupDraft) => void; onSave: () => void; onDiscard: () => void;
  /** Absent for a group that is not saved yet. */
  onDelete?: (() => void) | undefined;
  /**
   * Register a folder as a project and add it to this draft. A folder that
   * does not exist comes back as an offer to create it.
   */
  onRegister: (path: string) => Promise<TextSubmitFollowUp | void>;
}) {
  const form = useId();
  const commands: MenuCommand[] = [
    ...dirty && !fresh ? [{ label: "Discard changes", icon: <XIcon aria-hidden />, disabled: pending, onSelect: onDiscard }] : [],
    ...onDelete ? [{ label: "Delete group", icon: <Trash2Icon aria-hidden />, tone: "danger" as const, disabled: pending,
      confirm: "Delete? Its projects and chats stay", onSelect: onDelete }] : [],
  ];
  return <SettingsFrame back={back} title={fresh ? "New group" : draft.name.trim() || "Unnamed group"} error={error}
    status={pending ? "Saving…" : dirty ? "Unsaved changes" : undefined} actions={<>
      <HeaderButton label={fresh ? "Create group" : "Save"} form={form} disabled={pending || !dirty || !draft.name.trim()} />
      {commands.length ? <MenuButton label="Group commands" commands={commands} /> : null}
      {close}
    </>}>
    <form id={form} onSubmit={(event) => { event.preventDefault(); if (dirty && draft.name.trim()) onSave(); }}>
      <TitleField label="Group name" placeholder="Name the group" value={draft.name} maxLength={100} disabled={pending}
        hint="Choose the projects that belong together. The session list can then show only their sessions."
        onChange={(name) => onChange({ ...draft, name })} />
      <ChoiceList legend="Projects" missing="Project no longer registered" search="Find a project" disabled={pending}
        choices={projects.map((project) => ({ id: project.id, label: project.name, detail: project.path }))}
        chosen={draft.projectIds} onChange={(projectIds) => onChange({ ...draft, projectIds })} />
    </form>
    <TextSubmit label="Add a project folder" hint="For a repository that is not in the list yet. Forgerie adds the folder as a project and checks it here. If the folder does not exist, Forgerie offers to create it."
      action="Add folder" placeholder="/path/to/repository" pending={pending} onSubmit={onRegister} />
  </SettingsFrame>;
}
