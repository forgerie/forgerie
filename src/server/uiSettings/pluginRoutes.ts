import { z } from "zod";
import { mutationSchema } from "../../shared/pluginsContract.js";
import { errorMessage, readJsonBody, refuseCrossSite, sendJson, SettingsHttpError } from "./http.js";
import type { PluginService } from "./pluginService.js";
import type { Middleware } from "./routes.js";

const restartSchema = z.object({ revision: z.string().min(1), confirm: z.literal(true) });
const limits = { maxBytes: 100_000, tooLarge: "Plugin settings are limited to 100 KB.", requireJsonType: true };

/**
 *   GET  /aui/plugins           the plugin catalog and its revision
 *   POST /aui/plugins           { revision, change } (409 if the revision moved)
 *   POST /aui/plugins/restart   { revision, confirm: true }
 *   GET  /aui/plugins/readme    ?id=package:<source>  a Pi package's README as text
 *   GET  /aui/app-plugins       the browser app's bundled plugins: on or off, and their settings
 */
export function pluginMiddleware(service: PluginService): Middleware {
  return (request, response, next) => {
    const path = new URL(request.url ?? "/", "http://local").pathname;
    if (path !== "/aui/plugins" && path !== "/aui/plugins/restart" && path !== "/aui/plugins/readme" && path !== "/aui/app-plugins") { next(); return; }
    const handle = async () => {
      if (path === "/aui/plugins/readme") {
        if (request.method !== "GET") throw new SettingsHttpError(405, "Use GET.");
        const id = new URL(request.url ?? "/", "http://local").searchParams.get("id");
        if (id === null || id === "") throw new SettingsHttpError(400, "Name a package with ?id=.");
        return service.readme(id);
      }
      if (path === "/aui/app-plugins") {
        if (request.method !== "GET") throw new SettingsHttpError(405, "Use GET.");
        return service.appStates();
      }
      if (request.method === "GET" && path === "/aui/plugins") return service.list();
      if (request.method !== "POST") throw new SettingsHttpError(405, "Use GET or POST.");
      refuseCrossSite(request, "Plugin changes must come from this settings page.");
      if (path.endsWith("/restart")) {
        const input = restartSchema.parse(await readJsonBody(request, limits));
        return service.restart(input.revision);
      }
      const input = mutationSchema.parse(await readJsonBody(request, limits));
      return service.change(input.revision, input.change);
    };
    handle().then((value) => { sendJson(response, 200, value); }).catch((error: unknown) => {
      sendJson(response, error instanceof SettingsHttpError ? error.status : error instanceof z.ZodError ? 400 : 500, { error: errorMessage(error) });
    });
  };
}
