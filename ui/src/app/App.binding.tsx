import { useCallback, type ReactNode } from "react";
import { App } from "../App";
import { ProjectGroupSettings, useProjectGroups } from "../projectGroups/GroupControls.binding";
import { RelatedWorkspaces } from "../projectGroups/RelatedWorkspaces.binding";
import { createProjectGroupApi } from "../projectGroups/projectGroupApi";
import type { RelatedWorkRenderer } from "../projectGroups/relatedWork";
import type { SettingsPageRenderer } from "../ui/settings/SettingsView";
const request = (path: string, init?: RequestInit) => fetch(path, init);
const api = createProjectGroupApi(request);
/** The app with project groups: a filter in the session list's menu, a settings page, and related worktrees in each chat's header menu. */
export function AppBinding({ shelves }: { shelves?: ReactNode }) {
  const groups = useProjectGroups(api);
  const related = useCallback<RelatedWorkRenderer>(({ ref, busy, links, onAsk, own }) => <RelatedWorkspaces key={ref.id} source={ref} busy={busy} links={links} onAsk={onAsk} own={own} api={api} request={request} />, []);
  const settings = useCallback<SettingsPageRenderer>(({ back, close, item, onOpen }) =>
    <ProjectGroupSettings api={api} state={groups} group={item} onOpen={onOpen} back={back} close={close} />, [groups]);
  return <App shelves={shelves} projectScope={groups.scope} projectCatalog={groups.loaded ? groups.catalog.projects : undefined}
    projectFilter={groups.filter} projectSettings={settings} relatedWork={related} />;
}
