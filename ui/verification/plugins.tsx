// Production UI on an in-memory API, without network interception or real profile writes.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../src/ui/AppShell";
import { PluginsView } from "../src/ui/settings/PluginsView";
import type { PluginCatalog, PluginsApi } from "../src/plugins/pluginsApi";
import "../src/ui/theme.css";

let catalog: PluginCatalog = { profileDir: "/home/simonwjackson/.local/share/forgerie/agent", configPath: "/home/simonwjackson/.config/forgerie/config.json",
  revision: "fixture-1", restartAvailable: true, restartRequired: true, plugins: [
    { id: "package:goal", kind: "package", name: "npm:@narumitw/pi-goal", source: "npm:@narumitw/pi-goal", description: "Pi package", enabled: true },
    { id: "package:local", kind: "package", name: "/home/simonwjackson/code/sandbox/pi-mobbin", source: "/home/simonwjackson/code/sandbox/pi-mobbin", description: "Pi package", enabled: false },
    { id: "extension:context", kind: "extension", name: "startup-context.ts", source: "/home/simonwjackson/.local/share/forgerie/agent/extensions/startup-context.ts", description: "Loose Pi extension", enabled: true },
    { id: "forgerie:quota", kind: "forgerie", name: "cliproxyapi-quota", source: "local", description: "Browser plugin", enabled: true, settings: { five_hour: false, antigravity_claude: false, openrouter_key_limit: false } },
    { id: "forgerie:processes", kind: "forgerie", name: "processes", source: "bundled", description: "Bundled browser plugin", enabled: true, settings: {} },
    { id: "builtin:pi-subagents", kind: "builtin", name: "pi-subagents", source: "Forgerie", description: "Delegated agents", enabled: true },
  ] };
let serial = 1;
const api: PluginsApi = {
  list: async () => catalog,
  change: async (revision, change) => {
    if (revision !== catalog.revision) throw new Error("Plugin settings changed since you opened them. Reload before saving.");
    const plugins = catalog.plugins.flatMap((entry) => {
      if (change.type === "remove" && change.id === entry.id) return [];
      if (change.type === "toggle" && change.id === entry.id) return [{ ...entry, enabled: change.enabled }];
      if (change.type === "settings" && change.id === entry.id) return [{ ...entry, settings: change.settings }];
      return [entry];
    });
    if (change.type === "add") plugins.push({ id: `package:${change.source}`, kind: "package", name: change.source, source: change.source, description: "Pi package", enabled: true });
    catalog = { ...catalog, revision: `fixture-${String(++serial)}`, plugins, restartRequired: true };
    return catalog;
  },
  restart: async () => { catalog = { ...catalog, restartRequired: false }; return catalog; },
};
function Screen() {
  const [selected, setSelected] = useState(new URLSearchParams(location.search).get("plugin") ?? undefined);
  return <AppShell open={false} onOpenChange={() => {}} picker={() => <span />} thread={<PluginsView selected={selected} onOpen={setSelected} onBack={() => setSelected(undefined)} onClose={() => setSelected(undefined)} api={api} />} />;
}
createRoot(document.getElementById("root")!).render(<Screen />);
