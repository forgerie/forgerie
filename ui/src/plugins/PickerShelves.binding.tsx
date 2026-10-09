import { useEffect, useSyncExternalStore } from "react";
import { accountMetersManifest } from "@shared/appPluginManifests";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { AlertCard } from "../ui/AlertCard";
import type { AppPlugin } from "./appPlugin";
import { appPluginStore, type AppPluginStore } from "./appPluginStates";
import { AccountMetersShelf } from "./accountMeters/AccountMeters.binding";

/** Every plugin bundled with this app. Each has a manifest in src/shared/appPluginManifests.ts. */
export const APP_PLUGINS: readonly AppPlugin[] = [
  { manifest: accountMetersManifest, pickerShelf: AccountMetersShelf },
];

/**
 * Binding: the plugin slot at the foot of the session list. Reads the
 * bundled plugins' states and draws each plugin's shelf while it is on, in
 * registry order. A shelf that throws says so in its own place.
 */
export function PickerShelves({ plugins = APP_PLUGINS, store = appPluginStore }: { plugins?: readonly AppPlugin[]; store?: AppPluginStore }) {
  const states = useSyncExternalStore(store.subscribe, store.get);
  useEffect(() => { store.load(); }, [store]);
  if (!states) return null;
  return <>{plugins.map((plugin) => {
    const Shelf = plugin.pickerShelf;
    const state = states.get(plugin.manifest.id);
    if (!Shelf || !state?.enabled) return null;
    const { name } = plugin.manifest;
    return <ErrorBoundary key={plugin.manifest.id} onError={(error) => console.error(`Forgerie plugin "${name}" stopped.`, error)}
      fallback={(message) => <AlertCard label={`${name} stopped`} title={`${name} stopped`}>{message}</AlertCard>}>
      <Shelf settings={state.settings} />
    </ErrorBoundary>;
  })}</>;
}
