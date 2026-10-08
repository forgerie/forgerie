// Production UI on an in-memory API, without network interception or real profile writes.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../src/ui/AppShell";
import { PluginsView } from "../src/ui/settings/PluginsView";
import type { PluginCatalog, PluginsApi } from "../src/plugins/pluginsApi";
import "../src/ui/theme.css";

let catalog: PluginCatalog = { profileDir: "/home/simonwjackson/.local/share/forgerie/agent", configPath: "/home/simonwjackson/.config/forgerie/config.json",
  home: "/home/simonwjackson", revision: "fixture-1", restartAvailable: true, restartRequired: true, plugins: [
    { id: "package:goal", kind: "package", name: "@narumitw/pi-goal", source: "npm:@narumitw/pi-goal", version: "0.49.6", installed: true,
      description: "Pi extension for autonomous /goal completion with opt-in experimental ordered queues.", enabled: true },
    { id: "package:local", kind: "package", name: "@simonwjackson/pi-mobbin", source: "/home/simonwjackson/code/sandbox/pi-mobbin", version: "0.1.0", installed: true,
      description: "Pi tool for searching Mobbin's design reference library over its MCP endpoint.", enabled: false },
    { id: "package:gone", kind: "package", name: "pi-missing", source: "npm:pi-missing", installed: false, description: "", enabled: true },
    { id: "extension:context", kind: "extension", name: "startup-context", source: "/home/simonwjackson/.local/share/forgerie/agent/extensions/startup-context.ts", description: "", enabled: true },
    { id: "forgerie:quota", kind: "forgerie", name: "cliproxyapi-quota", source: "local", description: "", enabled: true, settings: { five_hour: false, antigravity_claude: false, openrouter_key_limit: false } },
    { id: "forgerie:processes", kind: "forgerie", name: "processes", source: "bundled", description: "", enabled: true, settings: {} },
    { id: "builtin:pi-subagents", kind: "builtin", name: "pi-subagents", source: "Forgerie", description: "Lets a session hand work to the agents in Settings.", enabled: true },
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
    if (change.type === "add") plugins.push({ id: `package:${change.source}`, kind: "package", name: change.source, source: change.source, description: "", enabled: true });
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
