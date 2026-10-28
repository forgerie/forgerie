// The app's model lists for parts and tests, with model chains, served from memory.
import type { ModelChains } from "@shared/modelChains";
import type { ModelPrefs } from "@shared/modelPrefsContract";
import type { ModelPrefsSource } from "../modelPrefsApi";
import { CHAINS } from "./chains";

export function chainPrefs(chains: ModelChains = CHAINS, problem: string | null = null): ModelPrefs {
  return { revision: "r1", favorites: [], visible: null, defaultModel: "openai/gpt-5", defaultThinkingLevel: "medium", titleModel: null,
    modelChains: chains, modelChainsProblem: problem, favoritesPath: "~/.pi/agent/settings.json", visiblePath: "~/.config/forgerie/models.json",
    configPath: "~/.config/forgerie/config.json", home: "/home/reader" };
}

/** A model prefs source that answers every read with these lists, as the live source does after a read. */
export function chainPrefsSource(prefs: ModelPrefs = chainPrefs()): ModelPrefsSource {
  const listeners = new Set<(prefs: ModelPrefs) => void>();
  const publish = () => { for (const listener of listeners) listener(prefs); return prefs; };
  return {
    read: async () => publish(),
    save: async () => publish(),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
