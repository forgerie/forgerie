// Production views with fixture APIs. No live services or network interception.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../src/ui/AppShell";
import { BacklogSettingsView } from "../src/backlog/BacklogSettings.binding";
import { BacklogView } from "../src/ui/backlog/BacklogView";
import { useBacklogScope } from "../src/backlog/backlogScope";
import type { BacklogPlace } from "../src/backlog/backlogModel";
import type { BacklogSettingsApi, BacklogSettingsCatalog } from "../src/backlog/backlogSettingsApi";
import type { BacklogItem } from "../src/backlog/backlogApi";
import "../src/ui/theme.css";
let catalog: BacklogSettingsCatalog = { settings: { githubLogin: "octocat", projects: [{ projectId: "p", source: "forgerie", revision: 1, backlog: { providers: ["azure-devops"], azureDevops: { organization: "example-org", project: "Product", areaPath: "Product\\Platform" } } }] }, projects: [{ id: "p", name: "Platform", path: "/example/platform" }] };
const api: BacklogSettingsApi = {
  list: async () => catalog,
  save: async (id, backlog, revision) => { catalog = { ...catalog, settings: { ...catalog.settings, projects: [{ projectId: id, source: "forgerie", backlog, revision: revision + 1 }] } }; return {}; },
  remove: async () => { catalog = { ...catalog, settings: { ...catalog.settings, projects: [{ projectId: "p", source: "default", backlog: { providers: ["markdown"] } }] } }; return {}; },
  githubLogin: async (login) => { const { githubLogin: _previous, ...settings } = catalog.settings; catalog = { ...catalog, settings: { ...settings, ...(login === null ? {} : { githubLogin: login }) } }; return {}; },
};
const items: BacklogItem[] = [
  { id: "example-org:7", title: "Check incentive totals", provider: "azure-devops", projectId: "p", projectName: "Platform", repo: "/example/platform", path: "example-org/Product#7", status: "Active", labels: ["User Story"], open: true, readiness: "ready", blockingIds: [], assignedToMe: true, assignees: ["Alex Morgan"] },
  { id: "example-org:8", title: "Remove duplicate adjustment rows", provider: "azure-devops", projectId: "p", projectName: "Platform", repo: "/example/platform", path: "example-org/Product#8", status: "Active", labels: ["Bug"], open: true, readiness: "ready", blockingIds: [], assignedToMe: false, assignees: ["Ada Chen"] },
];
function Screen() {
  const params = new URLSearchParams(location.search);
  const [selected, setSelected] = useState(params.get("project") ?? undefined);
  const [place, setPlace] = useState<BacklogPlace>({});
  const { scope, setScope } = useBacklogScope();
  const settings = params.get("page") === "settings";
  const thread = settings ? <BacklogSettingsView api={api} selected={selected} onOpen={setSelected} back={<button className="settings-back" onClick={() => setSelected(undefined)}>{selected ? "Backlog" : "Settings"}</button>} close={null} />
    : <BacklogView place={place} binding={{ scope, onScope: setScope, load: { type: "ready", value: { items: items.filter((item) => scope === "everyone" || item.assignedToMe), projects: [{ projectId: "p", providers: ["azure-devops"] }], warnings: [], generatedAt: "now" } }, onRefresh: () => {}, look: () => undefined, onPlace: setPlace, onLaunch: () => {}, onOpenSession: () => {}, api: {
      detail: async (ref) => ({ item: items.find((item) => item.id === ref.itemId)!, body: "Compare current totals and adjustments.", initialPrompt: "" }), release: async () => ({ released: true }),
    } }} />;
  return <AppShell open={false} onOpenChange={() => {}} picker={() => <span />} thread={thread} />;
}
createRoot(document.getElementById("root")!).render(<Screen />);
