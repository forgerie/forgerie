import { createContext, useContext, useEffect, useState } from "react";
import { z } from "zod";
import { modelPrefsSchema, type ModelPrefs, type ModelPrefsSave } from "@shared/modelPrefsContract";

/** A save the server refused because a list moved on. Reloading is the way out. */
export class PrefsConflict extends Error {}

/**
 * The app's model lists, as the browser reaches them. One source serves the
 * model menu, Ctrl+P, and the settings page, so a save on the settings page
 * reaches an open menu without a reload.
 */
export interface ModelPrefsSource {
  read: (signal?: AbortSignal) => Promise<ModelPrefs>;
  save: (save: ModelPrefsSave) => Promise<ModelPrefs>;
  /** Called with the lists after every read and save. Returns the unsubscribe. */
  subscribe: (listener: (prefs: ModelPrefs) => void) => () => void;
}

export function createModelPrefsSource(fetcher: typeof fetch = (input, init) => fetch(input, init)): ModelPrefsSource {
  const listeners = new Set<(prefs: ModelPrefs) => void>();
  const publish = (prefs: ModelPrefs) => { for (const listener of listeners) listener(prefs); return prefs; };
  async function call(init?: RequestInit): Promise<ModelPrefs> {
    const response = await fetcher("/aui/model-prefs", init);
    const value: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(value);
      const message = error.success ? error.data.error : `The model settings server answered ${String(response.status)}.`;
      throw response.status === 409 ? new PrefsConflict(message) : new Error(message);
    }
    return publish(modelPrefsSchema.parse(value));
  }
  return {
    read: (signal) => call(signal ? { signal } : {}),
    save: (save) => call({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(save) }),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export const liveModelPrefs = createModelPrefsSource();
/** Absent in isolated components and tests: the menu then shows every model, as before. */
export const ModelPrefsContext = createContext<ModelPrefsSource | undefined>(undefined);

/**
 * The lists for a view that is open now. Reads once on mount, then follows
 * every save. `undefined` while unknown or unreadable, so callers fall back to
 * showing every model rather than hiding any by mistake. `enabled: false`
 * reads nothing.
 */
export function useModelPrefs(enabled = true): ModelPrefs | undefined {
  const source = useContext(ModelPrefsContext);
  const [prefs, setPrefs] = useState<ModelPrefs>();
  useEffect(() => {
    if (!source || !enabled) return;
    const controller = new AbortController();
    const stop = source.subscribe((next) => { if (!controller.signal.aborted) setPrefs(next); });
    source.read(controller.signal).catch(() => { /* Unreadable lists hide nothing. */ });
    return () => { controller.abort(); stop(); };
  }, [source, enabled]);
  return prefs;
}
