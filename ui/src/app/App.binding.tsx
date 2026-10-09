import { useCallback, type ReactNode } from "react";
import { App } from "../App";
import { GroupFilter, ProjectGroupSettings, useProjectGroups } from "../projectGroups/GroupControls.binding";
import { RelatedWorkspaces } from "../projectGroups/RelatedWorkspaces.binding";
import { createProjectGroupApi } from "../projectGroups/projectGroupApi";
import type { RelatedWorkRenderer } from "../projectGroups/relatedWork";
import type { SettingsPageRenderer } from "../ui/settings/SettingsView";
const request = (path: string, init?: RequestInit) => fetch(path, init);
const api = createProjectGroupApi(request);
/** The app with project groups: a filter over the session list, a settings page, and related repos in each chat. */
export function AppBinding({ shelves }: { shelves?: ReactNode }) {
  const groups = useProjectGroups(api);
  const related = useCallback<RelatedWorkRenderer>((ref, busy, links, onAsk) => <RelatedWorkspaces key={ref.id} source={ref} busy={busy} links={links} onAsk={onAsk} api={api} request={request} />, []);
  const filter = useCallback((manage: () => void) => <GroupFilter state={groups} onManage={manage} />, [groups]);
  const settings = useCallback<SettingsPageRenderer>(({ back, close }) => <ProjectGroupSettings api={api} state={groups} back={back} close={close} />, [groups]);
  return <App shelves={shelves} projectScope={groups.scope} projectCatalog={groups.loaded ? groups.catalog.projects : undefined}
    groupControls={filter} projectSettings={settings} relatedWork={related} />;
}
