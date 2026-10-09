import type { ComponentType } from "react";
import type { AppPluginManifest, AppSettings } from "@shared/appPlugins";

/** What the app hands a plugin's interface: its settings, every one resolved to a value. */
export interface AppPluginProps { settings: AppSettings }

/**
 * A plugin bundled with this app. Its manifest is shared with Forgerie's
 * server (src/shared/appPluginManifests.ts), which lists it in Settings >
 * Plugins and stores its on switch and settings. The app draws its interface
 * only while it is on, in the places it names here. Register it in
 * PickerShelves.binding.tsx.
 *
 * A plugin reaches the app through these props only. It owns its own network
 * reads, timers, and styles, and cleans them up when it unmounts.
 */
export interface AppPlugin {
  manifest: AppPluginManifest;
  /** Drawn at the foot of the session list, above Backlog and Settings. */
  pickerShelf?: ComponentType<AppPluginProps>;
}
