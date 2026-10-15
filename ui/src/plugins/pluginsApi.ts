import { z } from "zod";
import type { Fetch } from "../newSession";
import { catalogSchema, readmeSchema, type PluginCatalog, type PluginChange, type PluginReadme } from "@shared/pluginsContract";
import { decisionHintsStatusSchema, type DecisionHintsStatus } from "@shared/decisionHints";
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

/** Settings reads only the effective key's presence and source, never its value. */
export const GATEWAY_KEY_PLUGIN = "app:decision-hints";
export type GatewayKey = DecisionHintsStatus | "unknown";
export function createRuntimeApi(fetchFn: Fetch) {
  async function changeGatewayKey(revision: string, apiKey?: string): Promise<DecisionHintsStatus> {
    try {
      const response = await fetchFn(`/aui/plugins/decision-hints/gateway-key${apiKey === undefined ? "/clear" : ""}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision, ...(apiKey === undefined ? {} : { apiKey }) }),
      });
      // Neither proxy errors nor JSON parser diagnostics may echo the submitted secret.
      if (!response.ok) throw new Error("Gateway key change refused.");
      const status = decisionHintsStatusSchema.safeParse(await response.json());
      if (!status.success) throw new Error("Invalid gateway key status.");
      return status.data;
    } catch { throw new Error("Could not change the gateway key. Reload Settings and try again."); }
  }
  return {
    setGatewayKey: (revision: string, apiKey: string) => changeGatewayKey(revision, apiKey),
    clearGatewayKey: (revision: string) => changeGatewayKey(revision),
    async gatewayKey(signal?: AbortSignal): Promise<GatewayKey> {
      const response = await fetchFn("/api/pi-web/runtime", { cache: "no-store", ...(signal ? { signal } : {}) });
      if (!response.ok) return "unknown";
      const sessiond = parsePiWebRuntimeResponse(await response.json())?.components.sessiond;
      const hints = sessiond?.available === true ? sessiond.decisionHints : undefined;
      return hints ?? "unknown";
    },
  };
}
export type RuntimeApi = ReturnType<typeof createRuntimeApi>;

/** Map the public presence contract to the shared write-only settings field. */
export function gatewayKeyView(status: GatewayKey | undefined) {
  const known = typeof status === "object" ? status : undefined;
  return {
    present: known?.source === "settings" || known?.keyPresent === true, editable: known !== undefined && known.source !== "environment",
    value: (status === undefined || status === "unknown") ? "Unknown" : known?.source === "environment" ? "Set by DECISION_GATEWAY_API_KEY" : known?.source === "settings" && "invalid" in known ? "Saved key file is unreadable" : known?.keyPresent ? "Set here" : "Not set",
    hint: known?.source === "environment" ? "Settings cannot replace or remove an environment key."
      : !known ? "Sessiond did not report it. Check that sessiond is running."
      : "Forgerie never shows the saved key. Changes apply to the next gateway request.",
  };
}
