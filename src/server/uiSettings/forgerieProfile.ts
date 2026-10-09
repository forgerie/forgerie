import { isAbsolute, join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { z } from "zod";

const runtimeSchema = z.object({ components: z.object({ sessiond: z.object({
  available: z.boolean(), activeAgentProfile: z.object({ dir: z.string(), command: z.string(), revision: z.string() }).optional(),
}) }) });
const configSchema = z.object({ path: z.string(), config: z.record(z.string(), z.unknown()) });
const errorSchema = z.object({ error: z.string() });
export interface ForgerieProfile { dir: string; command: string; revision: string; configPath: string }
export interface GatewayRequest { method?: "GET" | "POST" | "PUT"; headers?: Record<string, string>; body?: string }
/** Calls one of Forgerie's own `/api` routes and returns its JSON body. */
export type Gateway = (path: string, init?: GatewayRequest) => Promise<unknown>;

/**
 * Settings routes reuse Forgerie's own API instead of reading its config again,
 * so they see the profile sessiond actually runs, not a future config value.
 */
export function inProcessGateway(app: FastifyInstance): Gateway {
  return async (path, init = {}) => {
    const request: InjectOptions = { method: init.method ?? "GET", url: path, headers: init.headers ?? {} };
    if (init.body !== undefined) request.payload = init.body;
    const response = await app.inject(request);
    const value: unknown = response.body === "" ? undefined : JSON.parse(response.body);
    if (response.statusCode >= 400) {
      const error = errorSchema.safeParse(value);
      throw new Error(error.success ? error.data.error : `Forgerie answered HTTP ${String(response.statusCode)}.`);
    }
    return value;
  };
}

export async function activeForgerieProfile(gateway: Gateway): Promise<ForgerieProfile> {
  const [runtime, config] = await Promise.all([gateway("/api/pi-web/runtime"), gateway("/api/config")]);
  const daemon = runtimeSchema.parse(runtime).components.sessiond;
  const profile = daemon.activeAgentProfile;
  if (!daemon.available || profile === undefined) throw new Error("Forgerie's session daemon is unavailable. Start sessiond before editing settings.");
  const configPath = configSchema.parse(config).path;
  if (!isAbsolute(profile.dir) || !isAbsolute(configPath)) throw new Error("Forgerie did not report absolute settings paths.");
  return { ...profile, configPath };
}

export const agentsInProfile = (profile: ForgerieProfile): string => join(profile.dir, "agents");
