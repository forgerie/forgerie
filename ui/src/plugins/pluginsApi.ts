import { z } from "zod";
import type { Fetch } from "../newSession";
import { catalogSchema, readmeSchema, type PluginCatalog, type PluginChange, type PluginReadme } from "@shared/pluginsContract";

export interface RestartWait {
  /** How long to wait for Forgerie to stop, then to answer again. */
  timeoutMs: number;
  pollMs: number;
}
const restartWait: RestartWait = { timeoutMs: 90_000, pollMs: 1_000 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPluginsApi(fetchFn: Fetch, wait: RestartWait = restartWait) {
  async function read(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetchFn(path, init);
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(body);
      throw new Error(error.success ? error.data.error : `Plugins request failed: HTTP ${String(response.status)}.`);
    }
    return body;
  }
  const call = async (path: string, init?: RequestInit): Promise<PluginCatalog> => catalogSchema.parse(await read(path, init));
  /** A Pi package's README, read from its installed folder. */
  const readme = async (id: string, signal?: AbortSignal): Promise<PluginReadme> =>
    readmeSchema.parse(await read(`/aui/plugins/readme?id=${encodeURIComponent(id)}`, signal ? { signal } : undefined));
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const list = (signal?: AbortSignal) => call("/aui/plugins", signal ? { signal } : undefined);
  /**
   * The server answers, then restarts itself with sessiond a moment later.
   * Wait until a read fails (Forgerie went down) and a later read succeeds.
   */
  async function restart(revision: string): Promise<PluginCatalog> {
    await call("/aui/plugins/restart", post({ revision, confirm: true }));
    const deadline = Date.now() + wait.timeoutMs;
    let wentDown = false;
    for (;;) {
      await sleep(wait.pollMs);
      try {
        const catalog = await list();
        if (wentDown) return catalog;
      } catch (error) {
        wentDown = true;
        if (Date.now() >= deadline) throw error;
      }
      if (Date.now() >= deadline) throw new Error("Forgerie did not restart in time. Check the services on its host.");
    }
  }
  return {
    list,
    change: (revision: string, change: PluginChange) => call("/aui/plugins", post({ revision, change })),
    restart,
    readme,
  };
}
export type PluginsApi = ReturnType<typeof createPluginsApi>;
