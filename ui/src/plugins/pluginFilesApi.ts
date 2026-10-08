import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { z } from "zod";
import { PluginError, PluginService } from "./pluginService";
import { mutationSchema } from "./pluginsApi";

const restartSchema = z.object({ revision: z.string().min(1), confirm: z.literal(true) });
async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new PluginError(415, "Send JSON.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 100_000) throw new PluginError(413, "Plugin settings are limited to 100 KB.");
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new PluginError(400, "The request body is not JSON."); }
}
export function pluginMiddleware(service: PluginService) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = new URL(request.url ?? "/", "http://local").pathname;
    if (path !== "/aui/plugins" && path !== "/aui/plugins/restart") { next(); return; }
    const send = (status: number, value: unknown) => {
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");
      response.end(JSON.stringify(value));
    };
    const handle = async () => {
      if (request.method === "GET" && path === "/aui/plugins") return service.list();
      if (request.method !== "POST") throw new PluginError(405, "Use GET or POST.");
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) throw new PluginError(403, "Plugin changes must come from this settings page.");
      if (path.endsWith("/restart")) {
        const input = restartSchema.parse(await body(request));
        return service.restart(input.revision);
      }
      const input = mutationSchema.parse(await body(request));
      return service.change(input.revision, input.change);
    };
    handle().then((value) => send(200, value)).catch((error: unknown) => send(error instanceof PluginError ? error.status : error instanceof z.ZodError ? 400 : 500,
      { error: error instanceof Error ? error.message : String(error) }));
  };
}

/** Dev/preview adapter, like the Agents file API. Moves into Forgerie's server with this client. */
export function pluginFilesApi(service = new PluginService()): Plugin {
  const middleware = pluginMiddleware(service);
  return { name: "forgerie-plugin-settings", configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
