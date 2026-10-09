import type { ReactNode } from "react";
import { SettingsFrame } from "../ui/settings/SettingsFrame";
import { CollectionEditor } from "../ui/CollectionEditor";
import { ActionCard } from "../ui/ActionCard";
import { TextSubmit } from "../ui/TextSubmit";
import type { GroupCatalog } from "./projectGroupApi";
/** Settings → Project groups. The page takes the thread's place, as the other settings pages do. */
export function ProjectGroups({ catalog, pending, error, onSave, onRemove, onRefresh, onRegister, back, actions, children }: {
  children?: ReactNode;
  /** Settings' Back and Close controls. */
  back?: ReactNode; actions?: ReactNode;
  onRegister?: ((path: string) => Promise<void>) | undefined;
  catalog: GroupCatalog; pending: boolean; error?: string | undefined;
  onSave: (id: string | undefined, name: string, ids: string[], revision?: number) => Promise<void>;
  onRemove: (id: string, revision?: number) => Promise<void>; onRefresh: () => void;
}) {
  return <SettingsFrame back={back} title="Project groups" actions={actions}>
    <p>Group existing projects without moving their files or chats. Choose a group above the session list to show only its projects.</p>
    <CollectionEditor emptyText="No groups yet. Add one to keep related projects together." collections={catalog.groups.map((group) => ({ id: group.id, label: group.name, choiceIds: group.projectIds, version: group.revision }))}
      choices={catalog.projects.map((project) => ({ id: project.id, label: project.name, detail: project.path }))}
      pending={pending} error={error} onSave={onSave} onRemove={onRemove} />
    <ActionCard title="Keep projects separate" detail="Deleting a group only removes the group. Its projects and chats stay in place." actions={[{ label: "Refresh", onPress: onRefresh }]} />
    {onRegister && <TextSubmit label="Register an existing project folder" action="Register project" placeholder="/path/to/repository" pending={pending} onSubmit={onRegister} />}
    {children}
  </SettingsFrame>;
}
