import { z } from "zod";
import type { Fetch } from "../newSession";
import { catalogSchema, readmeSchema, type PluginCatalog, type PluginChange, type PluginReadme } from "@shared/pluginsContract";
import { parsePiWebRuntimeResponse } from "@shared/piWebStatusParsing";

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

/** The plugin whose gateway key lives in sessiond's environment. Settings shows whether the key is present, never the key. */
export const GATEWAY_KEY_PLUGIN = "app:decision-hints";
/** Whether sessiond has a gateway key: `present`, `missing`, or `unknown` when sessiond is down or does not say. */
export type GatewayKey = "present" | "missing" | "unknown";
export function createRuntimeApi(fetchFn: Fetch) {
  return {
    async gatewayKey(signal?: AbortSignal): Promise<GatewayKey> {
      const response = await fetchFn("/api/pi-web/runtime", { cache: "no-store", ...(signal ? { signal } : {}) });
      if (!response.ok) return "unknown";
      const sessiond = parsePiWebRuntimeResponse(await response.json())?.components.sessiond;
      const hints = sessiond?.available === true ? sessiond.decisionHints : undefined;
      return hints === undefined ? "unknown" : hints.keyPresent ? "present" : "missing";
    },
  };
}
export type RuntimeApi = ReturnType<typeof createRuntimeApi>;
