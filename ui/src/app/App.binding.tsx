import { useCallback, useMemo, type ReactNode } from "react";
import { App } from "../App";
import { ProjectGroupSettings, useProjectGroups } from "../projectGroups/GroupControls.binding";
import { RelatedWorkspaces } from "../projectGroups/RelatedWorkspaces.binding";
import { createProjectGroupApi } from "../projectGroups/projectGroupApi";
import type { RelatedWorkRenderer } from "../projectGroups/relatedWork";
import type { SettingsPageRenderer } from "../ui/settings/SettingsView";
import { ResourceLens, ResourceSettings } from "../resources/ResourceLibrary.binding";
import { createResourceApi } from "../resources/resourceApi";
import type { ResourceLensRenderer } from "../resources/resourceLens";
import { createSearchApi } from "../search/searchApi";
import { scopeFolders } from "../search/searchModel";
import { useSessionSearch } from "../search/useSessionSearch";
import { browserTransport } from "../sessionStore";
const request = (path: string, init?: RequestInit) => fetch(path, init);
const api = createProjectGroupApi(request);
const resourceApi = createResourceApi(request);
// Session search reads through the catalog's own transport and base.
const searchApi = createSearchApi(browserTransport.request);
const resourceSettings: SettingsPageRenderer = ({ back, close, item, onOpen }) => <ResourceSettings api={resourceApi} item={item} onOpen={onOpen} back={back} close={close} />;
const resourceLens: ResourceLensRenderer = ({ id, cwd, onClose }) => <ResourceLens key={id} api={resourceApi} sessionId={id} cwd={cwd} onClose={onClose} />;
/**
 * The app with project groups (a filter in the session list's menu, a settings page, and related worktrees in each chat's header menu)
 * and the skills and prompts editor (a settings page, and a sheet from each chat's header menu),
 * and session search, held here above the layout switch and scoped by the chosen group's folders.
 */
export function AppBinding({ shelves }: { shelves?: ReactNode }) {
  const groups = useProjectGroups(api);
  const scope = useMemo(() => scopeFolders(groups.catalog.projects, groups.scope), [groups.catalog.projects, groups.scope]);
  const search = useSessionSearch(searchApi, scope);
  const related = useCallback<RelatedWorkRenderer>(({ ref, busy, links, onAsk, own, commands }) => <RelatedWorkspaces key={ref.id} source={ref} busy={busy} links={links} onAsk={onAsk} own={own} commands={commands} api={api} request={request} />, []);
  const settings = useCallback<SettingsPageRenderer>(({ back, close, item, onOpen }) =>
    <ProjectGroupSettings api={api} state={groups} group={item} onOpen={onOpen} back={back} close={close} />, [groups]);
  return <App shelves={shelves} projectScope={groups.scope} projectCatalog={groups.loaded ? groups.catalog.projects : undefined}
    projectFilter={groups.filter} projectSettings={settings} search={search} relatedWork={related} resourceSettings={resourceSettings} resourceLens={resourceLens} />;
}
