import { isAbsolute, join } from "node:path";
import { z } from "zod";

const runtimeSchema = z.object({ components: z.object({ sessiond: z.object({
  available: z.boolean(), activeAgentProfile: z.object({ dir: z.string(), command: z.string(), revision: z.string() }).optional(),
}) }) });
const configSchema = z.object({ path: z.string(), config: z.record(z.string(), z.unknown()) });
export type ForgerieProfile = { dir: string; command: string; revision: string; configPath: string };
export type Gateway = (path: string, init?: RequestInit) => Promise<unknown>;

/** Server-only gateway. The dev client and sessiond must agree on the active profile, not a future config value. */
export const forgerieGateway: Gateway = async (path, init) => {
  const response = await fetch(new URL(path, process.env.FORGERIE_API_URL ?? "http://127.0.0.1:8504"), { ...init, signal: AbortSignal.timeout(120_000) });
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(value);
    throw new Error(error.success ? error.data.error : `Forgerie answered HTTP ${String(response.status)}.`);
  }
  return value;
};

export async function activeForgerieProfile(gateway: Gateway = forgerieGateway): Promise<ForgerieProfile> {
  const [runtime, config] = await Promise.all([gateway("/api/pi-web/runtime"), gateway("/api/config")]);
  const daemon = runtimeSchema.parse(runtime).components.sessiond;
  const profile = daemon.activeAgentProfile;
  if (!daemon.available || !profile) throw new Error("Forgerie's session daemon is unavailable. Start sessiond before editing settings.");
  const configPath = configSchema.parse(config).path;
  if (!isAbsolute(profile.dir) || !isAbsolute(configPath)) throw new Error("Forgerie did not report absolute settings paths.");
  return { ...profile, configPath };
}

export const agentsInProfile = (profile: ForgerieProfile) => join(profile.dir, "agents");
