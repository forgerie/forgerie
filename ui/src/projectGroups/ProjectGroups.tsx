import type { ReactNode } from "react";
import { PlusIcon, RefreshCwIcon, Trash2Icon, GitMergeIcon } from "lucide-react";
import { SettingsFrame } from "../ui/settings/SettingsFrame";
import { SettingsRow } from "../ui/settings/SettingsRow";
import { HeaderButton } from "../ui/HeaderButton";
import { MenuButton, type MenuCommand } from "../ui/MenuButton";
import { ListSection } from "../ui/ListSection";
import { ActionRow } from "../ui/ActionRow";
import { Lede } from "../ui/Lede";
import type { WorktreeCommand } from "../ui/WorktreeActions";
import type { WorktreeInfo } from "../worktrees/worktreeApi";
import type { GroupCatalog } from "./projectGroupApi";

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;
const repoName = (info: WorktreeInfo) => info.repo.split("/").filter(Boolean).at(-1) ?? info.repo;

function worktreeStatus(info: WorktreeInfo): { text: string; tone?: "danger" } {
  if (info.cleanup.kind === "failed") return { text: "Cleanup failed", tone: "danger" };
  if (info.state.kind === "landed") return { text: info.cleanup.kind === "done" ? "Landed" : "Landed, cleanup pending" };
  if (info.state.kind === "discarded") return { text: info.cleanup.kind === "done" ? "Discarded" : "Discarded, cleanup pending" };
  if (info.setup.phase === "failed") return { text: "Setup failed", tone: "danger" };
  if (info.setup.phase !== "done") return { text: "Setting up" };
  const changed = info.dirtyFiles ? `${plural(info.dirtyFiles, "changed file")}` : undefined;
  const ahead = info.ahead ? `${plural(info.ahead, "commit")} ahead` : undefined;
  return { text: [ahead, changed].filter(Boolean).join(", ") || "No changes" };
}

function worktreeCommands(info: WorktreeInfo, onCommand: (info: WorktreeInfo, command: WorktreeCommand) => void): MenuCommand[] {
  if (info.cleanup.kind === "done") return [];
  const land: MenuCommand = { label: info.state.kind === "landed" ? "Retry cleanup" : `Land on ${info.defaultBranch}`, icon: <GitMergeIcon aria-hidden />,
    disabled: info.state.kind === "discarded" || info.setup.phase !== "done", onSelect: () => onCommand(info, "land") };
  if (info.state.kind === "landed") return [land];
  return [land, { label: "Discard worktree", icon: <Trash2Icon aria-hidden />, tone: "danger", onSelect: () => onCommand(info, "discard") }];
}

/**
 * Settings → Project groups: the groups as a list, like Agents and Plugins,
 * and the related worktrees a chat left behind. A group opens as its own page.
 */
export function ProjectGroups({ back, close, catalog, loaded, error, worktrees, worktreeError, onNew, onOpen, onRefresh, onWorktree }: {
  /** Settings' Back and Close controls. */
  back?: ReactNode; close?: ReactNode;
  catalog: GroupCatalog; loaded: boolean; error?: string | undefined;
  worktrees: readonly WorktreeInfo[]; worktreeError?: string | undefined;
  onNew: () => void; onOpen: (id: string) => void; onRefresh: () => void;
  onWorktree: (info: WorktreeInfo, command: WorktreeCommand) => void;
}) {
  const names = new Map(catalog.projects.map((project) => [project.id, project.name]));
  return <SettingsFrame back={back} title="Project groups" actions={<>
    <HeaderButton label="New group" icon={<PlusIcon aria-hidden />} disabled={!loaded} onPress={onNew} />
    <MenuButton label="Project group commands" commands={[{ label: "Read groups again", icon: <RefreshCwIcon aria-hidden />, onSelect: onRefresh }]} />
    {close}
  </>} error={error} recovery={<button type="button" onClick={onRefresh}>Retry</button>}>
    <Lede>A group lists projects that belong together, such as the repos of one product. Pick a group from the session list’s ⋯ menu to show only its sessions. Projects, worktrees and chats stay where they are.</Lede>
    <ListSection title="Groups" empty={loaded ? "No groups yet. Use New group to choose the projects that belong together." : "Reading groups…"}>
      {catalog.groups.map((group) => {
        const members = group.projectIds.map((id) => names.get(id));
        const missing = members.filter((name) => name === undefined).length;
        return <SettingsRow key={group.id} name={group.name} meta={plural(group.projectIds.length, "project")}
          description={members.filter(Boolean).join(", ") || "No projects yet"} onOpen={() => onOpen(group.id)}
          flags={missing ? <span data-tone="error">{plural(missing, "project")} no longer registered</span> : null} />;
      })}
    </ListSection>
    {worktrees.length || worktreeError ? <ListSection title="Related worktrees" empty={worktreeError}
      note="A chat makes one when it works in a second repo. It stays here after the chat is archived, until you land or discard it.">
      {worktrees.map((info) => {
        const status = worktreeStatus(info);
        const commands = worktreeCommands(info, onWorktree);
        return <ActionRow key={info.id} name={repoName(info)} status={status.text} tone={status.tone}
          detail={<><code>{info.path}</code>{info.cleanup.kind === "failed" ? <><br />{info.cleanup.error}</> : null}</>}
          actions={commands.length ? <MenuButton label={`Commands for ${repoName(info)}`} commands={commands} /> : null} />;
      })}
    </ListSection> : null}
  </SettingsFrame>;
}
